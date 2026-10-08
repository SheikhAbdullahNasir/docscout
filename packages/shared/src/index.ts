export type HealthResponse = { status: 'ok' };

export type RepositoryMetadataRequest = { repositoryUrl: string };

export type PublicRepositoryMetadata = {
  owner: string;
  name: string;
  url: string;
  private: false;
  archived: boolean;
  defaultBranch: string;
};

// Metadata foundation only; this is deliberately not an analysis/scan response.
export type RepositoryMetadataResponse = {
  schemaVersion: 1;
  repository: PublicRepositoryMetadata;
};

export type RepositoryTreeEntry = {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  mode: '100644' | '100755' | '120000' | '040000' | '160000';
  sha: string;
  size?: number;
};

export type RepositoryDocumentCategory = 'readme' | 'contributing' | 'package-json' | 'docs';

export type RepositoryDocument = {
  path: string;
  category: RepositoryDocumentCategory;
  sourceUrl: string;
  text: string;
  sha: string;
  decodedSize: number;
  reportedSize: number;
  previewTruncated?: boolean;
};

export type RepositoryDocumentState =
  | { status: 'available'; document: RepositoryDocument }
  | { status: 'unavailable' | 'unknown'; message: string };

export type RepositoryDocumentSkip = {
  path: string;
  category: RepositoryDocumentCategory;
  reason: 'symlink' | 'submodule' | 'oversized' | 'binary' | 'git-lfs-pointer'
    | 'malformed' | 'unavailable' | 'combined-content-limit' | ScanResourceWarningCode;
};

export type RepositoryDocuments = {
  selectionComplete: boolean;
  readme: RepositoryDocumentState;
  contributing: RepositoryDocumentState;
  packageJson: RepositoryDocumentState;
  docs: RepositoryDocument[];
  skipped: RepositoryDocumentSkip[];
  omissions: Array<'docs-limit' | 'combined-content-limit' | ScanWarningCode>;
};

export type MissingLocalTargetFinding = {
  id: string;
  type: 'missing-local-target';
  title: string;
  observation: 'Target is absent from the scanned repository snapshot.';
  confidence: 'high';
  difficulty: 'unknown';
  evidence: {
    sourceDocumentPath: string;
    sourceUrl: string;
    sourceLine: number;
    excerpt: string;
    excerptTruncated?: boolean;
    linkText: string;
    originalTarget: string;
    normalizedTarget: string;
  };
  whyItMatters: string;
  verificationSteps: string[];
  limitations: string[];
};

export type RepositoryMarkdownLinkAnalysis = {
  findings: MissingLocalTargetFinding[];
  coverage: {
    documentsAnalyzed: number;
    documentsUnchecked: number;
    supportedLinksChecked: number;
    uncheckedLinks: number;
    unsupportedLinks: number;
    findingsProduced: number;
    findingsOmitted: number;
    uncheckedByReason: {
      incompleteTree: number;
      unresolvedReference: number;
      fragmentAnchor: number;
    };
    uncheckedDocumentsByReason: {
      parserSafetyLimit: number;
      scanDeadline?: number;
    };
    unsupportedByReason: {
      images: number;
      external: number;
      protocolRelative: number;
      mailto: number;
      pureAnchor: number;
      otherScheme: number;
      suspiciousTarget: number;
    };
    limitations: string[];
  };
};

export type PossibleMissingNpmScriptFinding = {
  id: string;
  type: 'possible-missing-npm-script';
  title: string;
  confidence: 'needs-review';
  difficulty: 'unknown';
  evidence: {
    sourceDocumentPath: string;
    sourceUrl: string;
    sourceLine: number;
    excerpt: string;
    excerptTruncated?: boolean;
    command: string;
    script: string;
    manifestPath: 'package.json';
  };
  whyItMatters: string;
  verificationSteps: string[];
  limitations: string[];
};

export type RepositoryNpmScriptAnalysis = {
  findings: PossibleMissingNpmScriptFinding[];
  coverage: {
    status: 'checked' | 'skipped';
    skipReason?: 'readme-unavailable' | 'manifest-unavailable' | 'manifest-invalid-json'
      | 'manifest-not-object' | 'scripts-missing' | 'scripts-invalid' | 'parser-safety-limit' | 'scan-deadline';
    supportedCommandsChecked: number;
    commandsSkipped: number;
    findingsProduced: number;
    findingsOmitted: number;
    skippedByReason: {
      unsupportedBlock: number;
      unsupportedCommand: number;
      ambiguousShell: number;
      ifPresent: number;
      workspace: number;
      nonRootWorkingDirectory: number;
      uncertainWorkingDirectory: number;
    };
    limitations: string[];
  };
};

export type SupportedIssueLabel = 'good first issue' | 'help wanted';

export type RepositoryIssue = {
  number: number;
  title: string;
  url: string;
  labels: string[];
  updatedAt: string;
  assignees: string[];
  assigned: boolean;
  bodyExcerpt: string;
  bodyExcerptTruncated?: boolean;
};

export type RepositoryIssueQueryCoverage = {
  label: SupportedIssueLabel;
  status: 'complete' | 'partial' | 'failed';
  pagesFetched: number;
  capped: boolean;
  message?: string;
  reason?: ScanResourceWarningCode;
};

export type RepositoryIssues = {
  fetchedAt: string;
  items: RepositoryIssue[];
  coverage: {
    complete: boolean;
    sampled: boolean;
    queries: RepositoryIssueQueryCoverage[];
  };
};

export type LabeledIssueFinding = {
  id: string;
  type: 'labeled-issue';
  title: 'Maintainer-labeled good first issue' | 'Maintainer-labeled help wanted issue';
  confidence: 'maintainer-label';
  difficulty: 'unknown';
  evidence: {
    sourceUrl: string;
    issueNumber: number;
    issueTitle: string;
    labels: string[];
    assigned: boolean;
    assignees: string[];
    excerpt: string;
    excerptTruncated?: boolean;
    updatedAt: string;
  };
  whyItMatters: string;
  verificationSteps: string[];
  limitations: string[];
};

export type RepositoryLabeledIssueAnalysis = {
  findings: LabeledIssueFinding[];
  coverage: {
    eligibleIssues: number;
    findingsProduced: number;
    findingsOmitted: number;
    issueRetrieval: RepositoryIssues['coverage'];
    limitations: string[];
  };
};

export type Finding = MissingLocalTargetFinding | PossibleMissingNpmScriptFinding | LabeledIssueFinding;

export type FindingAggregationCoverage = {
  documentationFindingsProduced: number;
  documentationFindingsOmitted: number;
  issueFindingsProduced: number;
};

export type EmptyRepositoryAnalysis = {
  findings: Finding[];
  coverage: FindingAggregationCoverage;
  labeledIssues: RepositoryLabeledIssueAnalysis;
};

export type ScanResourceWarningCode = 'GITHUB_REQUEST_BUDGET_EXHAUSTED' | 'SCAN_DEADLINE_EXCEEDED'
  | 'GITHUB_REQUEST_TIMEOUT' | 'GITHUB_RESPONSE_TOO_LARGE';
export type ScanWarningCode = ScanResourceWarningCode | 'BROWSER_RESPONSE_LIMIT';
export type ScanWarning = { code: ScanWarningCode; message: string };
export type RepositoryScanCoverage = {
  status: 'partial';
  githubRequests: number;
  warnings: ScanWarning[];
  responseOmissions?: {
    previews: number; excerpts: number; treeEntries: number; issueRecords: number;
    documents: number; skippedDocuments: number; findings: number;
  };
};

export type RepositorySnapshotResult = (
  | { status: 'ready'; snapshot: {
    defaultBranch: string;
    commitSha: string;
    treeSha: string;
    tree: { entries: RepositoryTreeEntry[]; truncated: boolean; complete: boolean };
    documents: RepositoryDocuments;
    analysis: {
      findings: Finding[];
      coverage: FindingAggregationCoverage;
      markdownLinks: RepositoryMarkdownLinkAnalysis;
      npmScripts: RepositoryNpmScriptAnalysis;
      labeledIssues: RepositoryLabeledIssueAnalysis;
    };
  }; issues: RepositoryIssues }
  | { status: 'empty'; snapshot: null; message: string; issues: RepositoryIssues; analysis: EmptyRepositoryAnalysis }
) & { scan?: RepositoryScanCoverage };

export type RepositorySnapshotResponse = RepositorySnapshotResult & {
  schemaVersion: 1;
  repository: PublicRepositoryMetadata;
  scannedAt: string;
  cached: boolean;
};

export type RepositoryErrorCode =
  | 'INVALID_REPOSITORY_URL' | 'INVALID_REQUEST_BODY' | 'REQUEST_TOO_LARGE'
  | 'SCAN_CANCELLED'
  | 'REPOSITORY_UNAVAILABLE' | 'PRIVATE_REPOSITORY' | 'GITHUB_AUTH_ERROR'
  | 'GITHUB_FORBIDDEN' | 'GITHUB_COOLDOWN' | 'GITHUB_UPSTREAM_FAILURE'
  | 'COMMIT_LOOKUP_FAILED' | 'TREE_LOOKUP_FAILED' | ScanResourceWarningCode;

export type RepositoryErrorResponse = {
  error: { code: RepositoryErrorCode; message: string; retryAt?: string };
  requestId: string;
};
