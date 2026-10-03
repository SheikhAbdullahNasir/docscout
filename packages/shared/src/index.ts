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
};

export type RepositoryDocumentState =
  | { status: 'available'; document: RepositoryDocument }
  | { status: 'unavailable' | 'unknown'; message: string };

export type RepositoryDocumentSkip = {
  path: string;
  category: RepositoryDocumentCategory;
  reason: 'symlink' | 'submodule' | 'oversized' | 'binary' | 'git-lfs-pointer'
    | 'malformed' | 'unavailable' | 'combined-content-limit';
};

export type RepositoryDocuments = {
  selectionComplete: boolean;
  readme: RepositoryDocumentState;
  contributing: RepositoryDocumentState;
  packageJson: RepositoryDocumentState;
  docs: RepositoryDocument[];
  skipped: RepositoryDocumentSkip[];
  omissions: Array<'docs-limit' | 'combined-content-limit'>;
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
};

export type RepositoryIssueQueryCoverage = {
  label: SupportedIssueLabel;
  status: 'complete' | 'partial' | 'failed';
  pagesFetched: number;
  capped: boolean;
  message?: string;
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

export type RepositorySnapshotResult =
  | { status: 'ready'; snapshot: {
    defaultBranch: string;
    commitSha: string;
    treeSha: string;
    tree: { entries: RepositoryTreeEntry[]; truncated: boolean; complete: boolean };
    documents: RepositoryDocuments;
  }; issues: RepositoryIssues }
  | { status: 'empty'; snapshot: null; message: string; issues: RepositoryIssues };

export type RepositorySnapshotResponse = RepositorySnapshotResult & {
  schemaVersion: 1;
  repository: PublicRepositoryMetadata;
};

export type RepositoryErrorCode =
  | 'INVALID_REPOSITORY_URL' | 'INVALID_REQUEST_BODY' | 'REQUEST_TOO_LARGE'
  | 'REPOSITORY_UNAVAILABLE' | 'PRIVATE_REPOSITORY' | 'GITHUB_AUTH_ERROR'
  | 'GITHUB_FORBIDDEN' | 'GITHUB_COOLDOWN' | 'GITHUB_UPSTREAM_FAILURE'
  | 'COMMIT_LOOKUP_FAILED' | 'TREE_LOOKUP_FAILED';

export type RepositoryErrorResponse = {
  error: { code: RepositoryErrorCode; message: string; retryAt?: string };
  requestId: string;
};
