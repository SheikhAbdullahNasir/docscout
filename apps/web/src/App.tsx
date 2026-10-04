import { useState, type FormEvent } from 'react';
import type {
  Finding,
  LabeledIssueFinding,
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

function isIssueCoverage(value: unknown): boolean {
  if (!isRecord(value) || typeof value.complete !== 'boolean' || typeof value.sampled !== 'boolean'
    || !Array.isArray(value.queries)) return false;
  return value.queries.every((query) => isRecord(query)
    && (query.label === 'good first issue' || query.label === 'help wanted')
    && (query.status === 'complete' || query.status === 'partial' || query.status === 'failed')
    && isCount(query.pagesFetched) && typeof query.capped === 'boolean'
    && (query.message === undefined || typeof query.message === 'string'));
}

function isLabeledIssueAnalysis(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.findings) || !isRecord(value.coverage)) return false;
  const findings = value.findings.every((finding) => isRecord(finding)
    && typeof finding.id === 'string' && finding.type === 'labeled-issue'
    && (finding.title === 'Maintainer-labeled good first issue'
      || finding.title === 'Maintainer-labeled help wanted issue')
    && finding.confidence === 'maintainer-label' && finding.difficulty === 'unknown'
    && isRecord(finding.evidence) && typeof finding.evidence.sourceUrl === 'string'
    && isCount(finding.evidence.issueNumber) && finding.evidence.issueNumber > 0
    && typeof finding.evidence.issueTitle === 'string' && isStringArray(finding.evidence.labels)
    && typeof finding.evidence.assigned === 'boolean' && isStringArray(finding.evidence.assignees)
    && typeof finding.evidence.excerpt === 'string' && typeof finding.evidence.updatedAt === 'string'
    && typeof finding.whyItMatters === 'string'
    && isStringArray(finding.verificationSteps) && isStringArray(finding.limitations));
  const coverage = value.coverage;
  return findings
    && ['eligibleIssues', 'findingsProduced', 'findingsOmitted'].every((key) => isCount(coverage[key]))
    && isIssueCoverage(coverage.issueRetrieval)
    && isStringArray(coverage.limitations);
}

function isOrderedFindingList(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  let issueSeen = false;
  return value.every((finding) => {
    if (!isRecord(finding) || typeof finding.id !== 'string') return false;
    if (finding.type === 'labeled-issue') {
      issueSeen = true;
      return true;
    }
    return !issueSeen && (finding.type === 'missing-local-target'
      || finding.type === 'possible-missing-npm-script');
  });
}

function isAggregationCoverage(value: unknown): boolean {
  return isRecord(value)
    && isCount(value.documentationFindingsProduced)
    && isCount(value.documentationFindingsOmitted)
    && isCount(value.issueFindingsProduced);
}

function isSnapshotResponse(value: unknown): value is RepositorySnapshotResponse {
  if (!isRecord(value) || value.schemaVersion !== 1 || (value.status !== 'ready' && value.status !== 'empty')) return false;
  const repository = value.repository;
  const issues = value.issues;
  if (!isRecord(repository) || typeof repository.owner !== 'string' || typeof repository.name !== 'string'
    || typeof repository.url !== 'string' || typeof repository.archived !== 'boolean'
    || typeof repository.defaultBranch !== 'string' || repository.private !== false) return false;
  if (!isRecord(issues) || !Array.isArray(issues.items) || !isIssueCoverage(issues.coverage)) return false;
  const validItems = issues.items.every((issue) => isRecord(issue) && typeof issue.number === 'number'
    && typeof issue.title === 'string' && typeof issue.url === 'string' && isStringArray(issue.labels)
    && typeof issue.updatedAt === 'string' && isStringArray(issue.assignees)
    && typeof issue.assigned === 'boolean' && typeof issue.bodyExcerpt === 'string');
  if (!validItems) return false;
  if (value.status === 'empty') {
    return value.snapshot === null && typeof value.message === 'string'
      && isRecord(value.analysis) && isOrderedFindingList(value.analysis.findings)
      && isAggregationCoverage(value.analysis.coverage)
      && isLabeledIssueAnalysis(value.analysis.labeledIssues);
  }
  if (!isRecord(value.snapshot) || typeof value.snapshot.commitSha !== 'string'
    || !isRecord(value.snapshot.tree) || typeof value.snapshot.tree.complete !== 'boolean'
    || !isRecord(value.snapshot.documents) || !isRecord(value.snapshot.analysis)
    || !isOrderedFindingList(value.snapshot.analysis.findings)
    || !isAggregationCoverage(value.snapshot.analysis.coverage)
    || !isMarkdownLinkAnalysis(value.snapshot.analysis.markdownLinks)
    || !isNpmScriptAnalysis(value.snapshot.analysis.npmScripts)
    || !isLabeledIssueAnalysis(value.snapshot.analysis.labeledIssues)) return false;
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

function FindingEvidence({ finding }: { finding: Finding }) {
  if (finding.type === 'labeled-issue') {
    const evidence = finding.evidence;
    return (
      <>
        <p><a href={evidence.sourceUrl} target="_blank" rel="noreferrer">View issue source on GitHub</a></p>
        <p>Issue #{evidence.issueNumber}: {evidence.issueTitle}</p>
        <div className="labels" aria-label="Maintainer-provided labels">
          {evidence.labels.map((label) => <span key={label}>{label}</span>)}
        </div>
        <p className="issue-meta">
          {evidence.assigned ? `Assigned to ${evidence.assignees.join(', ')}` : 'Unassigned'}
        </p>
        {evidence.excerpt && <p className="issue-excerpt">{evidence.excerpt}</p>}
      </>
    );
  }

  const evidence = finding.evidence;
  return (
    <>
      <p><a href={evidence.sourceUrl} target="_blank" rel="noreferrer">View pinned evidence on GitHub</a></p>
      <p>{evidence.sourceDocumentPath}, line {evidence.sourceLine}</p>
      <pre className="document-preview">{evidence.excerpt}</pre>
      {finding.type === 'missing-local-target' ? (
        <p>Referenced target: <code>{finding.evidence.originalTarget}</code></p>
      ) : (
        <p>Command: <code>{finding.evidence.command}</code> · Script: <code>{finding.evidence.script}</code></p>
      )}
    </>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <article className="issue finding-card">
      <h3>{finding.title}</h3>
      <p className="issue-meta">Confidence: {finding.confidence} · Difficulty: {finding.difficulty}</p>
      <h4>Evidence and source</h4>
      <FindingEvidence finding={finding} />
      <h4>Why it matters</h4>
      <p>{finding.whyItMatters}</p>
      <h4>Verification and next steps</h4>
      <ul>{finding.verificationSteps.map((step) => <li key={step}>{step}</li>)}</ul>
      <h4>Limitations</h4>
      <ul>{finding.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
    </article>
  );
}

function Findings({ findings }: { findings: Finding[] }) {
  const documentationFindings = findings.filter((finding) => finding.type !== 'labeled-issue');
  const issueFindings = findings.filter((finding): finding is LabeledIssueFinding => finding.type === 'labeled-issue');
  return (
    <>
      <section className="result-section findings-section" aria-labelledby="documentation-findings-heading">
        <h2 id="documentation-findings-heading">Documentation findings</h2>
        {documentationFindings.length > 0 ? (
          <div className="issue-list">
            {documentationFindings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}
          </div>
        ) : (
          <p>No documentation findings were produced from the available checked evidence.</p>
        )}
      </section>
      <section className="result-section findings-section" aria-labelledby="issue-findings-heading">
        <h2 id="issue-findings-heading">Labeled issue opportunities</h2>
        <p className="section-note">Maintainer labels are evidence of a possible opportunity, not a DocScout difficulty estimate.</p>
        {issueFindings.length > 0 ? (
          <div className="issue-list">
            {issueFindings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}
          </div>
        ) : (
          <p>No labeled issue opportunities were produced from the available supported-label evidence.</p>
        )}
      </section>
    </>
  );
}

const npmSkipMessages = {
  'readme-unavailable': 'the README was unavailable',
  'manifest-unavailable': 'the root package.json was unavailable',
  'manifest-invalid-json': 'the root package.json was not valid JSON',
  'manifest-not-object': 'the root package.json was not a JSON object',
  'scripts-missing': 'the root package.json had no scripts field',
  'scripts-invalid': 'the root package.json scripts field was not usable',
  'parser-safety-limit': 'the README exceeded the parser safety limit',
} as const;

function issueQuerySummary(query: RepositoryIssues['coverage']['queries'][number]): string {
  if (query.pagesFetched === 0) return `${query.label}: ${query.status} before any page was fetched.`;
  const pages = `${query.pagesFetched} page${query.pagesFetched === 1 ? '' : 's'}`;
  return `${query.label}: ${query.status} after ${pages}${query.capped ? '; results were capped' : ''}.`;
}

function Coverage({ result }: { result: RepositorySnapshotResponse }) {
  const findingsCoverage = result.status === 'ready'
    ? result.snapshot.analysis.coverage : result.analysis.coverage;
  const labeledIssueCoverage = result.status === 'ready'
    ? result.snapshot.analysis.labeledIssues.coverage : result.analysis.labeledIssues.coverage;

  if (result.status === 'empty') {
    return (
      <section className="coverage" aria-labelledby="coverage-heading">
        <h2 id="coverage-heading">Coverage and scan status</h2>
        <p className="notice">Partial coverage — no commit-backed repository snapshot was available.</p>
        <p>Document and documentation-analyzer coverage was not available.</p>
        <p>{result.issues.coverage.complete && !result.issues.coverage.sampled
          ? 'Issue coverage: complete for both supported label queries.'
          : 'Issue coverage was partial; only returned issue evidence is shown.'}</p>
        <ul>
          {result.issues.coverage.queries.map((query) => <li key={query.label}>{issueQuerySummary(query)}</li>)}
          {labeledIssueCoverage.findingsOmitted > 0 && (
            <li>Issue opportunities omitted by result limits: {labeledIssueCoverage.findingsOmitted}.</li>
          )}
        </ul>
      </section>
    );
  }

  const { documents, tree, analysis } = result.snapshot;
  const documentStates = [documents.readme, documents.contributing, documents.packageJson];
  const availableDocuments = documentStates.filter((state) => state.status === 'available').length + documents.docs.length;
  const unavailableDocuments = documentStates.filter((state) => state.status !== 'available').length;
  const issueCoverageComplete = result.issues.coverage.complete && !result.issues.coverage.sampled;
  const complete = tree.complete && documents.selectionComplete && documents.skipped.length === 0
    && documents.omissions.length === 0
    && analysis.markdownLinks.coverage.documentsUnchecked === 0
    && analysis.markdownLinks.coverage.uncheckedLinks === 0
    && analysis.npmScripts.coverage.status === 'checked' && issueCoverageComplete
    && findingsCoverage.documentationFindingsOmitted === 0 && labeledIssueCoverage.findingsOmitted === 0;
  const npmCoverage = analysis.npmScripts.coverage;

  return (
    <section className="coverage" aria-labelledby="coverage-heading">
      <h2 id="coverage-heading">Coverage and scan status</h2>
      <p className={complete ? undefined : 'notice'}>
        {complete
          ? 'Coverage complete for the available repository snapshot.'
          : 'Partial coverage — useful checked evidence is shown below.'}
      </p>
      <ul>
        <li>{tree.complete
          ? 'Repository tree: complete.'
          : `Repository tree: incomplete${tree.truncated ? ' because GitHub returned a truncated tree' : ''}.`}</li>
        <li>Document selection: {documents.selectionComplete ? 'complete' : 'incomplete'}.</li>
        <li>Selected documents available: {availableDocuments}.</li>
        <li>Selected documents unavailable or unknown: {unavailableDocuments}.</li>
        <li>Selected documents skipped: {documents.skipped.length}.</li>
        <li>Markdown documents: {analysis.markdownLinks.coverage.documentsAnalyzed} analyzed,{' '}
          {analysis.markdownLinks.coverage.documentsUnchecked} unchecked.</li>
        <li>Local links: {analysis.markdownLinks.coverage.supportedLinksChecked} checked,{' '}
          {analysis.markdownLinks.coverage.uncheckedLinks} unchecked,{' '}
          {analysis.markdownLinks.coverage.unsupportedLinks} unsupported.</li>
        <li>{npmCoverage.status === 'checked'
          ? 'npm-script analysis: checked.'
          : `npm-script analysis: skipped because ${npmCoverage.skipReason
            ? npmSkipMessages[npmCoverage.skipReason] : 'no skip reason was provided'}.`}</li>
        <li>{issueCoverageComplete
          ? 'Issue coverage: complete for both supported label queries.'
          : 'Issue coverage: partial, sampled, capped, or unavailable for at least one supported label query.'}</li>
        {result.issues.coverage.queries.map((query) => <li key={query.label}>{issueQuerySummary(query)}</li>)}
        {documents.omissions.includes('docs-limit') && (
          <li>Additional selected docs were omitted by the document limit.</li>
        )}
        {documents.omissions.includes('combined-content-limit') && (
          <li>Selected document content was omitted after the combined content limit was reached.</li>
        )}
        {findingsCoverage.documentationFindingsOmitted > 0 && (
          <li>Documentation suggestions omitted by result limits: {findingsCoverage.documentationFindingsOmitted}.</li>
        )}
        {labeledIssueCoverage.findingsOmitted > 0 && (
          <li>Issue opportunities omitted by result limits: {labeledIssueCoverage.findingsOmitted}.</li>
        )}
        {result.issues.coverage.queries.map((query) => query.message
          ? <li key={`${query.label}-message`}>{query.label}: {query.message}</li> : null)}
      </ul>
    </section>
  );
}

function Results({ result }: { result: RepositorySnapshotResponse }) {
  const contributionCandidateSkipped = result.status === 'ready'
    && result.snapshot.documents.skipped.some((skip) => skip.category === 'contributing');
  const findings = result.status === 'ready' ? result.snapshot.analysis.findings : result.analysis.findings;
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
      {findings.length === 0 && <p className="notice">No suggestions found in the checked scope.</p>}
      <Findings findings={findings} />
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
