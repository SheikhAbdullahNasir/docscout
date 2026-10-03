import type { RepositoryErrorCode } from '@docscout/shared';

export class ApplicationError extends Error {
  constructor(
    readonly status: number,
    readonly code: RepositoryErrorCode,
    message: string,
    readonly retryAt?: string,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
