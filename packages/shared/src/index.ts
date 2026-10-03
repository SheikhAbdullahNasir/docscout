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

export type RepositorySnapshotResult =
  | { status: 'ready'; snapshot: {
    defaultBranch: string;
    commitSha: string;
    treeSha: string;
    tree: { entries: RepositoryTreeEntry[]; truncated: boolean; complete: boolean };
  } }
  | { status: 'empty'; snapshot: null; message: string };

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
