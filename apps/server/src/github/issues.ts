import type {
  PublicRepositoryMetadata, RepositoryIssue, RepositoryIssueQueryCoverage, RepositoryIssues,
  SupportedIssueLabel,
} from '@docscout/shared';
import { ApplicationError } from '../errors.js';
import { isResourceError } from './scanBudget.js';

export const SUPPORTED_ISSUE_LABELS = ['good first issue', 'help wanted'] as const satisfies readonly SupportedIssueLabel[];
const EMPTY_QUERY_MESSAGE = 'No matches were returned for the supported label query.';
const INVALID_DATA_MESSAGE = 'Issue coverage for this label is unavailable because GitHub returned invalid issue data.';
const INCOMPLETE_DATA_MESSAGE = 'Issue coverage for this label is incomplete because GitHub returned invalid issue data.';
const FAILED_REQUEST_MESSAGE = 'Issue coverage for this label is unavailable because GitHub could not complete the request.';
const INCOMPLETE_REQUEST_MESSAGE = 'Issue coverage for this label is incomplete because GitHub could not complete the request.';
const INVALID_PAGINATION_MESSAGE = 'Issue coverage for this label is incomplete because GitHub pagination was invalid.';
const CAPPED_MESSAGE = 'Issue results sampled because another page was available after the two-page limit.';

type IssuePage = { value: unknown; link: string | null };
type IssuePageLoader = (label: SupportedIssueLabel, page: number) => Promise<IssuePage>;

class InvalidIssueData extends Error {}
class InvalidPagination extends Error {}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function safeText(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= maximum && (allowEmpty || value.length > 0)
    && ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13 || code === 127;
    });
}

function boundedExcerpt(body: unknown): string {
  if (body === null) return '';
  if (typeof body !== 'string') throw new InvalidIssueData();
  const normalized = body.replace(/\s+/gu, ' ').trim();
  return [...normalized].slice(0, 500).join('');
}

function issueUrl(repository: PublicRepositoryMetadata, number: number): string {
  return `https://github.com/${repository.owner}/${repository.name}/issues/${number}`;
}

function parseIssue(value: unknown, repository: PublicRepositoryMetadata): RepositoryIssue | undefined {
  const data = object(value);
  if (!data) throw new InvalidIssueData();
  if ('pull_request' in data) return undefined;
  const number = data.number;
  if (!Number.isSafeInteger(number) || (number as number) <= 0 || !safeText(data.title, 1_000)
    || data.state !== 'open' || data.html_url !== issueUrl(repository, number as number)
    || !Array.isArray(data.labels) || data.labels.length > 100
    || !Array.isArray(data.assignees) || data.assignees.length > 100
    || typeof data.updated_at !== 'string') throw new InvalidIssueData();

  const labels = data.labels.map((value: unknown) => {
    const name = object(value)?.name;
    if (!safeText(name, 100)) throw new InvalidIssueData();
    return name;
  });
  const assignees = data.assignees.map((value: unknown) => {
    const login = object(value)?.login;
    if (!safeText(login, 100)) throw new InvalidIssueData();
    return login;
  });
  if (new Set(labels).size !== labels.length || new Set(assignees).size !== assignees.length) {
    throw new InvalidIssueData();
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(data.updated_at)) {
    throw new InvalidIssueData();
  }
  const updated = new Date(data.updated_at);
  if (!Number.isFinite(updated.getTime())) throw new InvalidIssueData();
  return {
    number: number as number,
    title: data.title,
    url: data.html_url,
    labels,
    updatedAt: updated.toISOString(),
    assignees,
    assigned: assignees.length > 0,
    bodyExcerpt: boundedExcerpt(data.body),
  };
}

function parseIssuePage(value: unknown, repository: PublicRepositoryMetadata): RepositoryIssue[] {
  if (!Array.isArray(value) || value.length > 100) throw new InvalidIssueData();
  return value.map((item) => parseIssue(item, repository))
    .filter((item): item is RepositoryIssue => item !== undefined);
}

function expectedPath(repository: PublicRepositoryMetadata): string {
  return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues`;
}

function nextPage(
  link: string | null,
  repository: PublicRepositoryMetadata,
  label: SupportedIssueLabel,
  currentPage: number,
): number | undefined {
  if (link === null) return undefined;
  const nextTargets: string[] = [];
  for (const part of link.split(',')) {
    const match = /^\s*<([^>]+)>\s*;(.*)$/u.exec(part);
    if (!match) continue;
    const relation = /(?:^|;)\s*rel="([^"]+)"/u.exec(match[2])?.[1]?.split(/\s+/u) ?? [];
    if (relation.includes('next')) nextTargets.push(match[1]);
  }
  if (nextTargets.length === 0) return undefined;
  if (nextTargets.length !== 1) throw new InvalidPagination();
  let url: URL;
  try {
    url = new URL(nextTargets[0]);
  } catch {
    throw new InvalidPagination();
  }
  const entries = [...url.searchParams.entries()];
  const expected = new Map([
    ['state', 'open'], ['labels', label], ['sort', 'updated'], ['direction', 'desc'],
    ['per_page', '100'], ['page', String(currentPage + 1)],
  ]);
  if (url.protocol !== 'https:' || url.host !== 'api.github.com' || url.pathname !== expectedPath(repository)
    || entries.length !== expected.size || entries.some(([key, value]) => expected.get(key) !== value)
    || new Set(entries.map(([key]) => key)).size !== expected.size) throw new InvalidPagination();
  return currentPage + 1;
}

function fatalIssueError(error: unknown): boolean {
  return error instanceof ApplicationError
    && ['GITHUB_AUTH_ERROR', 'GITHUB_FORBIDDEN', 'GITHUB_COOLDOWN'].includes(error.code);
}

async function retrieveLabel(
  repository: PublicRepositoryMetadata,
  label: SupportedIssueLabel,
  load: IssuePageLoader,
): Promise<{ items: RepositoryIssue[]; coverage: RepositoryIssueQueryCoverage }> {
  const items: RepositoryIssue[] = [];
  let pagesFetched = 0;
  let page = 1;
  while (page <= 2) {
    let response: IssuePage;
    try {
      response = await load(label, page);
    } catch (error) {
      if (fatalIssueError(error)) throw error;
      return { items, coverage: {
        label, status: pagesFetched === 0 ? 'failed' : 'partial', pagesFetched, capped: false,
        ...(isResourceError(error)
          ? { reason: error.code, message: error.message }
          : { message: pagesFetched === 0 ? FAILED_REQUEST_MESSAGE : INCOMPLETE_REQUEST_MESSAGE }),
      } };
    }
    let pageItems: RepositoryIssue[];
    try {
      pageItems = parseIssuePage(response.value, repository);
    } catch {
      return { items, coverage: {
        label, status: pagesFetched === 0 ? 'failed' : 'partial', pagesFetched, capped: false,
        message: pagesFetched === 0 ? INVALID_DATA_MESSAGE : INCOMPLETE_DATA_MESSAGE,
      } };
    }
    pagesFetched += 1;
    items.push(...pageItems);
    let following: number | undefined;
    try {
      following = nextPage(response.link, repository, label, page);
    } catch {
      return { items, coverage: {
        label, status: 'partial', pagesFetched, capped: false, message: INVALID_PAGINATION_MESSAGE,
      } };
    }
    if (following === undefined) {
      return { items, coverage: {
        label, status: 'complete', pagesFetched, capped: false,
        ...(items.length === 0 ? { message: EMPTY_QUERY_MESSAGE } : {}),
      } };
    }
    if (page === 2) {
      return { items, coverage: {
        label, status: 'complete', pagesFetched, capped: true, message: CAPPED_MESSAGE,
      } };
    }
    page = following;
  }
  throw new Error('unreachable');
}

export async function retrieveIssues(
  repository: PublicRepositoryMetadata,
  load: IssuePageLoader,
  now: () => Date,
): Promise<RepositoryIssues> {
  const streams = [];
  for (const label of SUPPORTED_ISSUE_LABELS) streams.push(await retrieveLabel(repository, label, load));
  if (streams.every(({ coverage }) => coverage.status === 'failed')
    && !streams.some(({ coverage }) => coverage.reason)) {
    throw new ApplicationError(502, 'GITHUB_UPSTREAM_FAILURE', 'GitHub issue coverage could not be retrieved. Please try again later.');
  }
  const unique = new Map<number, RepositoryIssue>();
  for (const { items } of streams) {
    for (const item of items) if (!unique.has(item.number)) unique.set(item.number, item);
  }
  const queries = streams.map(({ coverage }) => coverage);
  const sampled = queries.some(({ capped }) => capped);
  return {
    fetchedAt: now().toISOString(),
    items: [...unique.values()],
    coverage: {
      complete: queries.every(({ status, capped }) => status === 'complete' && !capped),
      sampled,
      queries,
    },
  };
}
