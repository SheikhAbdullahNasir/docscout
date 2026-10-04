import { createHash } from 'node:crypto';
import type {
  LabeledIssueFinding,
  PublicRepositoryMetadata,
  RepositoryIssue,
  RepositoryIssues,
  RepositoryLabeledIssueAnalysis,
} from '@docscout/shared';

type AnalyzerInput = {
  repository: PublicRepositoryMetadata;
  issues: RepositoryIssues;
};

const MAX_FINDINGS = 20;
const GOOD_FIRST_ISSUE = 'good first issue';
const HELP_WANTED = 'help wanted';
const VERIFICATION_STEPS = [
  'Open the issue and read the latest discussion.',
  'Check whether someone is already working on it and confirm the current assignment and status.',
  'Read repository-local CONTRIBUTING guidance before starting work.',
  'Inspect linked pull requests and recent comments for current context.',
  'Ask the maintainers before substantial work if expectations are unclear.',
];
const BASE_LIMITATIONS = [
  'Maintainer labels are source evidence, not DocScout difficulty estimates or guarantees that work is currently available.',
  'Issue state, discussion, and assignment can change after the scan; verify the current issue before starting work.',
];

function supportedLabels(issue: RepositoryIssue): { goodFirst: boolean; helpWanted: boolean } {
  return {
    goodFirst: issue.labels.some((label) => label.toLocaleLowerCase('en-US') === GOOD_FIRST_ISSUE),
    helpWanted: issue.labels.some((label) => label.toLocaleLowerCase('en-US') === HELP_WANTED),
  };
}

function rank(issue: RepositoryIssue): number {
  const labels = supportedLabels(issue);
  if (labels.goodFirst) return issue.assigned ? 1 : 0;
  return 2;
}

function compareIssues(left: RepositoryIssue, right: RepositoryIssue): number {
  return rank(left) - rank(right)
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.number - right.number
    || left.url.localeCompare(right.url);
}

function findingId(issue: RepositoryIssue): string {
  const key = `labeled-issue\0${issue.url}\0${issue.number}`;
  return `labeled-issue:${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

function retrievalLimitations(issues: RepositoryIssues): string[] {
  return [
    ...(issues.coverage.sampled
      ? ['Issue retrieval was sampled, so these findings may not cover all possible maintainer-labeled opportunities.']
      : []),
    ...(!issues.coverage.complete
      ? ['Issue retrieval was partial, so these findings may not cover all possible maintainer-labeled opportunities.']
      : []),
  ];
}

function finding(
  issue: RepositoryIssue,
  repository: PublicRepositoryMetadata,
  coverageLimitations: string[],
): LabeledIssueFinding {
  const goodFirst = supportedLabels(issue).goodFirst;
  const limitations = [...BASE_LIMITATIONS];
  if (issue.assigned) {
    limitations.push('This issue was assigned when scanned; check the current discussion and assignment before considering any work available.');
  }
  if (repository.archived) {
    limitations.push('This repository is archived and may no longer be actively maintained; verify current project status before considering work.');
  }
  limitations.push(...coverageLimitations);
  return {
    id: findingId(issue),
    type: 'labeled-issue',
    title: goodFirst ? 'Maintainer-labeled good first issue' : 'Maintainer-labeled help wanted issue',
    confidence: 'maintainer-label',
    difficulty: 'unknown',
    evidence: {
      sourceUrl: issue.url,
      issueNumber: issue.number,
      issueTitle: issue.title,
      labels: [...issue.labels],
      assigned: issue.assigned,
      assignees: [...issue.assignees],
      excerpt: issue.bodyExcerpt,
      updatedAt: issue.updatedAt,
    },
    whyItMatters: goodFirst
      ? 'Repository maintainers applied a label commonly intended to signal a possible starting point.'
      : 'Repository maintainers marked this issue as seeking help.',
    verificationSteps: [...VERIFICATION_STEPS],
    limitations,
  };
}

export function analyzeLabeledIssues({ repository, issues }: AnalyzerInput): RepositoryLabeledIssueAnalysis {
  const unique = new Map<number, RepositoryIssue>();
  for (const issue of issues.items) {
    const labels = supportedLabels(issue);
    if ((labels.goodFirst || labels.helpWanted) && !unique.has(issue.number)) unique.set(issue.number, issue);
  }
  const eligible = [...unique.values()].sort(compareIssues);
  const coverageLimitations = retrievalLimitations(issues);
  const findings = eligible.slice(0, MAX_FINDINGS)
    .map((issue) => finding(issue, repository, coverageLimitations));
  const findingsOmitted = eligible.length - findings.length;
  const limitations = [
    ...coverageLimitations,
    ...(findingsOmitted > 0
      ? [`Only the top ${MAX_FINDINGS} deterministic issue findings are returned; ${findingsOmitted} eligible issue findings were omitted.`]
      : []),
  ];
  return {
    findings,
    coverage: {
      eligibleIssues: eligible.length,
      findingsProduced: findings.length,
      findingsOmitted,
      issueRetrieval: {
        complete: issues.coverage.complete,
        sampled: issues.coverage.sampled,
        queries: issues.coverage.queries.map((query) => ({ ...query })),
      },
      limitations,
    },
  };
}
