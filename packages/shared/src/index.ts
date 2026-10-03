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

export type RepositoryErrorCode =
  | 'INVALID_REPOSITORY_URL' | 'INVALID_REQUEST_BODY' | 'REQUEST_TOO_LARGE'
  | 'REPOSITORY_UNAVAILABLE' | 'PRIVATE_REPOSITORY' | 'GITHUB_AUTH_ERROR'
  | 'GITHUB_FORBIDDEN' | 'GITHUB_COOLDOWN' | 'GITHUB_UPSTREAM_FAILURE';

export type RepositoryErrorResponse = {
  error: { code: RepositoryErrorCode; message: string; retryAt?: string };
  requestId: string;
};
