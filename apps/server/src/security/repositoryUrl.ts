import { ApplicationError } from '../errors.js';

declare const validatedRepository: unique symbol;
export type ValidatedRepository = {
  readonly owner: string;
  readonly repo: string;
  readonly [validatedRepository]: true;
};

export function validOwner(owner: unknown): owner is string {
  return typeof owner === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner);
}

export function validRepo(repo: unknown): repo is string {
  return typeof repo === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(repo) && repo !== '.' && repo !== '..';
}

export function parseRepositoryUrl(input: unknown): ValidatedRepository {
  const invalid = () => new ApplicationError(400, 'INVALID_REPOSITORY_URL',
    'Enter a public repository URL such as https://github.com/owner/repo, optionally ending in .git or /.');
  if (typeof input !== 'string' || input.length > 2048) throw invalid();
  // Match the raw input before URL normalization: :443, dot segments, backslashes,
  // control characters, percent encodings, and empty ?/# must never disappear.
  const match = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/?$/i.exec(input.trim());
  if (!match) throw invalid();
  const owner = match[1];
  const repo = match[2].endsWith('.git') ? match[2].slice(0, -4) : match[2];
  if (!validOwner(owner) || !validRepo(repo)) throw invalid();
  return { owner, repo } as ValidatedRepository;
}
