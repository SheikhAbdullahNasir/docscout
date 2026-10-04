import { useState, type FormEvent } from 'react';
import type {
  RepositoryDocumentState,
  RepositoryErrorResponse,
  RepositoryIssue,
  RepositoryIssues,
  RepositorySnapshotResponse,
} from '@docscout/shared';

type ScanState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: RepositorySnapshotResponse }
  | { status: 'error'; message: string };

const repositoryPattern = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/?$/;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function isDocumentState(value: unknown): value is RepositoryDocumentState {
  if (!isRecord(value) || typeof value.status !== 'string') return false;
  if (value.status === 'unavailable' || value.status === 'unknown') return typeof value.message === 'string';
  if (value.status !== 'available' || !isRecord(value.document)) return false;
  return typeof value.document.path === 'string'
    && typeof value.document.sourceUrl === 'string'
    && typeof value.document.text === 'string';
}

function isMarkdownLinkAnalysis(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.findings) || !isRecord(value.coverage)) return false;
  const findings = value.findings.every((finding) => isRecord(finding)
    && typeof finding.id === 'string' && finding.type === 'missing-local-target'
    && typeof finding.title === 'string'
    && finding.observation === 'Target is absent from the scanned repository snapshot.'
    && finding.confidence === 'high' && finding.difficulty === 'unknown'
    && isRecord(finding.evidence)
    && typeof finding.evidence.sourceDocumentPath === 'string'
    && typeof finding.evidence.sourceUrl === 'string'
    && isCount(finding.evidence.sourceLine) && finding.evidence.sourceLine > 0
    && typeof finding.evidence.excerpt === 'string'
    && typeof finding.evidence.linkText === 'string'
    && typeof finding.evidence.originalTarget === 'string'
    && typeof finding.evidence.normalizedTarget === 'string'
    && typeof finding.whyItMatters === 'string'
    && isStringArray(finding.verificationSteps) && isStringArray(finding.limitations));
  const coverage = value.coverage;
  const unchecked = coverage.uncheckedByReason;
  const unsupported = coverage.unsupportedByReason;
  return findings
    && ['documentsAnalyzed', 'documentsUnchecked', 'supportedLinksChecked', 'uncheckedLinks', 'unsupportedLinks', 'findingsProduced', 'findingsOmitted']
      .every((key) => isCount(coverage[key]))
    && isRecord(unchecked) && isCount(unchecked.incompleteTree)
    && isCount(unchecked.unresolvedReference) && isCount(unchecked.fragmentAnchor)
    && isRecord(coverage.uncheckedDocumentsByReason)
    && isCount(coverage.uncheckedDocumentsByReason.parserSafetyLimit)
    && isRecord(unsupported)
    && ['images', 'external', 'protocolRelative', 'mailto', 'pureAnchor', 'otherScheme', 'suspiciousTarget']
      .every((key) => isCount(unsupported[key]))
    && isStringArray(coverage.limitations);
}

function isNpmScriptAnalysis(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.findings) || !isRecord(value.coverage)) return false;
  const findings = value.findings.every((finding) => isRecord(finding)
    && typeof finding.id === 'string' && finding.type === 'possible-missing-npm-script'
    && typeof finding.title === 'string' && finding.confidence === 'needs-review'
    && finding.difficulty === 'unknown' && isRecord(finding.evidence)
    && typeof finding.evidence.sourceDocumentPath === 'string'
    && typeof finding.evidence.sourceUrl === 'string'
    && isCount(finding.evidence.sourceLine) && finding.evidence.sourceLine > 0
    && typeof finding.evidence.excerpt === 'string'
    && typeof finding.evidence.command === 'string'
    && typeof finding.evidence.script === 'string'
    && finding.evidence.manifestPath === 'package.json'
    && typeof finding.whyItMatters === 'string'
    && isStringArray(finding.verificationSteps) && isStringArray(finding.limitations));
  const coverage = value.coverage;
  const skipReasons = [
    'readme-unavailable', 'manifest-unavailable', 'manifest-invalid-json',
    'manifest-not-object', 'scripts-missing', 'scripts-invalid', 'parser-safety-limit',
  ];
  const skipped = coverage.skippedByReason;
  return findings && (coverage.status === 'checked' || coverage.status === 'skipped')
    && (coverage.status === 'checked'
      ? coverage.skipReason === undefined
      : typeof coverage.skipReason === 'string' && skipReasons.includes(coverage.skipReason))
    && ['supportedCommandsChecked', 'commandsSkipped', 'findingsProduced', 'findingsOmitted']
      .every((key) => isCount(coverage[key]))
    && isRecord(skipped)
    && ['unsupportedBlock', 'unsupportedCommand', 'ambiguousShell', 'ifPresent', 'workspace',
      'nonRootWorkingDirectory', 'uncertainWorkingDirectory'].every((key) => isCount(skipped[key]))
    && isStringArray(coverage.limitations);
}

function isSnapshotResponse(value: unknown): value is RepositorySnapshotResponse {
  if (!isRecord(value) || value.schemaVersion !== 1 || (value.status !== 'ready' && value.status !== 'empty')) return false;
  const repository = value.repository;
  const issues = value.issues;
  if (!isRecord(repository) || typeof repository.owner !== 'string' || typeof repository.name !== 'string'
    || typeof repository.url !== 'string' || typeof repository.archived !== 'boolean'
    || typeof repository.defaultBranch !== 'string' || repository.private !== false) return false;
  if (!isRecord(issues) || !Array.isArray(issues.items) || !isRecord(issues.coverage)
    || typeof issues.coverage.complete !== 'boolean' || typeof issues.coverage.sampled !== 'boolean'
    || !Array.isArray(issues.coverage.queries)) return false;
  const validItems = issues.items.every((issue) => isRecord(issue) && typeof issue.number === 'number'
    && typeof issue.title === 'string' && typeof issue.url === 'string' && isStringArray(issue.labels)
    && typeof issue.updatedAt === 'string' && isStringArray(issue.assignees)
    && typeof issue.assigned === 'boolean' && typeof issue.bodyExcerpt === 'string');
  const validQueries = issues.coverage.queries.every((query) => isRecord(query)
    && (query.label === 'good first issue' || query.label === 'help wanted')
    && (query.status === 'complete' || query.status === 'partial' || query.status === 'failed')
    && typeof query.pagesFetched === 'number' && typeof query.capped === 'boolean'
    && (query.message === undefined || typeof query.message === 'string'));
  if (!validItems || !validQueries) return false;
  if (value.status === 'empty') return value.snapshot === null && typeof value.message === 'string';
  if (!isRecord(value.snapshot) || typeof value.snapshot.commitSha !== 'string'
    || !isRecord(value.snapshot.tree) || typeof value.snapshot.tree.complete !== 'boolean'
    || !isRecord(value.snapshot.documents) || !isRecord(value.snapshot.analysis)
    || !isMarkdownLinkAnalysis(value.snapshot.analysis.markdownLinks)
    || !isNpmScriptAnalysis(value.snapshot.analysis.npmScripts)) return false;
  const documents = value.snapshot.documents;
  return typeof documents.selectionComplete === 'boolean'
    && isDocumentState(documents.readme) && isDocumentState(documents.contributing)
    && Array.isArray(documents.skipped) && documents.skipped.every((skip) => isRecord(skip) && typeof skip.category === 'string')
    && isStringArray(documents.omissions);
}

function readServerError(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('error' in value)) return undefined;
  const error = (value as Partial<RepositoryErrorResponse>).error;
  if (!error || typeof error.message !== 'string') return undefined;
  return error.retryAt ? `${error.message} Retry after ${error.retryAt}.` : error.message;
}

function DocumentPreview({ title, state, missingMessage }: {
  title: string;
  state: RepositoryDocumentState;
  missingMessage?: string;
}) {
  return (
    <section className="result-section" aria-label={title}>
      <h2>{title}</h2>
      {state.status === 'available' ? (
        <>
          <h3>{state.document.path}</h3>
          <p><a href={state.document.sourceUrl} target="_blank" rel="noreferrer">View pinned source on GitHub</a></p>
          <pre className="document-preview">{state.document.text}</pre>
        </>
      ) : (
        <p className={state.status === 'unknown' ? 'notice' : undefined}>
          {state.status === 'unavailable' && missingMessage
            && state.message === 'Repository-local contribution guidance is unavailable.' ? missingMessage : state.message}
        </p>
      )}
    </section>
  );
}

function IssueItem({ issue }: { issue: RepositoryIssue }) {
  return (
    <article className="issue">
      <h3><a href={issue.url} target="_blank" rel="noreferrer">#{issue.number} {issue.title}</a></h3>
      <div className="labels" aria-label="Maintainer-provided labels">
        {issue.labels.map((label) => <span key={label}>{label}</span>)}
      </div>
      <p className="issue-meta">
        Updated <time dateTime={issue.updatedAt}>{new Date(issue.updatedAt).toLocaleString()}</time>
        {' · '}{issue.assigned ? `Assigned to ${issue.assignees.join(', ')}` : 'Unassigned'}
      </p>
      {issue.bodyExcerpt && <p className="issue-excerpt">{issue.bodyExcerpt}</p>}
    </article>
  );
}

function Issues({ issues }: { issues: RepositoryIssues }) {
  return (
    <section className="result-section" aria-labelledby="issues-heading">
      <h2 id="issues-heading">Labeled issues</h2>
      <p className="section-note">Labels are maintainer-provided evidence, not a DocScout difficulty estimate.</p>
      {issues.items.length > 0 ? (
        <div className="issue-list">{issues.items.map((issue) => <IssueItem key={issue.number} issue={issue} />)}</div>
      ) : issues.coverage.complete ? (
        <p>No open issues matched the supported good first issue/help wanted label queries.</p>
      ) : (
        <p>No issue records were returned from the available supported label coverage.</p>
      )}
    </section>
  );
}

function Coverage({ result }: { result: RepositorySnapshotResponse }) {
  const messages: Array<{ key: string; text: string }> = [];
  if (result.status === 'ready') {
    if (!result.snapshot.tree.complete) messages.push({ key: 'tree', text: 'Repository path coverage is incomplete.' });
    if (!result.snapshot.documents.selectionComplete) {
      messages.push({ key: 'documents', text: 'Document selection may be incomplete because repository path coverage is incomplete.' });
    }
    if (result.snapshot.documents.skipped.length > 0) {
      const count = result.snapshot.documents.skipped.length;
      messages.push({ key: 'skipped', text: `${count} selected document${count === 1 ? '' : 's'} could not be displayed safely.` });
    }
    if (result.snapshot.documents.omissions.includes('docs-limit')) {
      messages.push({ key: 'docs-limit', text: 'Additional docs results were limited to the bounded document selection.' });
    }
    if (result.snapshot.documents.omissions.includes('combined-content-limit')) {
      messages.push({ key: 'content-limit', text: 'Selected document content reached the combined safe-content limit.' });
    }
  }
  for (const query of result.issues.coverage.queries) {
    if (query.message && (query.status !== 'complete' || query.capped)) {
      messages.push({ key: `issues-${query.label}`, text: `${query.label}: ${query.message}` });
    }
  }
  if (messages.length === 0) return null;

  return (
    <section className="coverage" aria-labelledby="coverage-heading">
      <h2 id="coverage-heading">Coverage notes</h2>
      <ul>{messages.map((message) => <li key={message.key}>{message.text}</li>)}</ul>
    </section>
  );
}

function Results({ result }: { result: RepositorySnapshotResponse }) {
  const contributionCandidateSkipped = result.status === 'ready'
    && result.snapshot.documents.skipped.some((skip) => skip.category === 'contributing');
  return (
    <div className="results">
      <p role="status" className="visually-hidden">Repository analysis complete.</p>
      <section className="repository-summary" aria-labelledby="repository-heading">
        <p className="eyebrow">PHASE 1 REPOSITORY SNAPSHOT</p>
        <h2 id="repository-heading">{result.repository.owner}/{result.repository.name}</h2>
        <p><a href={result.repository.url} target="_blank" rel="noreferrer">Open repository on GitHub</a></p>
        {result.repository.archived && <p className="archive-notice">Archived repository</p>}
        <dl>
          <div><dt>Default branch</dt><dd>{result.repository.defaultBranch}</dd></div>
          <div><dt>Snapshot status</dt><dd>{result.status}</dd></div>
          {result.status === 'ready' && (
            <div><dt>Pinned commit</dt><dd><code title={result.snapshot.commitSha}>{result.snapshot.commitSha.slice(0, 12)}</code></dd></div>
          )}
        </dl>
        {result.status === 'empty' && <p className="notice">{result.message}</p>}
      </section>

      {result.status === 'ready' ? (
        <>
          <DocumentPreview title="README" state={result.snapshot.documents.readme} />
          <DocumentPreview
            title="Contribution guidance"
            state={result.snapshot.documents.contributing}
            missingMessage={contributionCandidateSkipped
              ? undefined : 'Repository-local contribution guidance was not found in the checked locations.'}
          />
        </>
      ) : (
        <section className="result-section" aria-label="Repository documents">
          <h2>Repository documents</h2>
          <p>No document snapshot is available because this repository has no commit to scan.</p>
        </section>
      )}
      <Issues issues={result.issues} />
      <Coverage result={result} />
    </div>
  );
}

export function App() {
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [inputError, setInputError] = useState('');
  const [scan, setScan] = useState<ScanState>({ status: 'idle' });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = repositoryUrl.trim();
    setInputError('');
    if (!repositoryPattern.test(value)) {
      setInputError('Enter a public repository URL such as https://github.com/owner/repo.');
      setScan({ status: 'idle' });
      return;
    }

    setScan({ status: 'loading' });
    try {
      const response = await fetch('/api/repository/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repositoryUrl: value }),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        setScan({ status: 'error', message: readServerError(body) ?? 'Repository analysis could not be completed. Please try again later.' });
        return;
      }
      if (!isSnapshotResponse(body)) {
        setScan({ status: 'error', message: 'Repository analysis returned an invalid response. Please try again later.' });
        return;
      }
      setScan({ status: 'success', result: body });
    } catch {
      setScan({ status: 'error', message: 'Repository analysis could not reach the server. Please try again later.' });
    }
  }

  return (
    <main>
      <p className="eyebrow">DOCSCOUT · PHASE 1</p>
      <h1>A starting point for your next contribution.</h1>
      <p className="intro">Inspect selected repository guidance and maintainer-labeled issues from one pinned public GitHub snapshot.</p>
      <form onSubmit={submit} noValidate>
        <label htmlFor="repository">GitHub repository URL</label>
        <p id="url-help">Use https://github.com/owner/repo. No login or credentials required.</p>
        <div className="form-row">
          <input id="repository" type="url" value={repositoryUrl}
            onChange={(event) => { setRepositoryUrl(event.target.value); setInputError(''); setScan({ status: 'idle' }); }}
            placeholder="https://github.com/owner/repo" autoComplete="url"
            spellCheck={false} required aria-invalid={Boolean(inputError)} disabled={scan.status === 'loading'}
            aria-describedby={inputError ? 'url-help url-error' : 'url-help'} />
          <button type="submit" disabled={scan.status === 'loading'}>Analyze repository</button>
        </div>
        {inputError && <p id="url-error" role="alert" className="error">{inputError}</p>}
        {scan.status === 'loading' && <p role="status" aria-live="polite">Analyzing repository…</p>}
        {scan.status === 'error' && <p role="alert" className="error">{scan.message}</p>}
      </form>
      {scan.status === 'success' ? <Results result={scan.result} /> : (
        scan.status === 'idle' && <aside>
          <h2>What this scan checks</h2>
          <p>DocScout displays a pinned README, repository-local contribution guidance, and open issues from the supported labels when available.</p>
          <p>Repository content is treated as untrusted plain text. AI, repository execution, and GitHub writes are disabled.</p>
        </aside>
      )}
    </main>
  );
}
