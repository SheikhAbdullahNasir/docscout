import { describe, expect, it } from 'vitest';
import { parseRepositoryUrl } from './repositoryUrl.js';

describe('repository URL validation', () => {
  it.each([
    'https://github.com/Owner/repo',
    ' https://github.com/Owner/repo \n',
    'https://github.com/Owner/repo/',
    'https://github.com/Owner/repo.git',
    'https://github.com/Owner/repo.git/',
  ])('normalizes supported input: %s', (url) => {
    expect(parseRepositoryUrl(url)).toEqual({ owner: 'Owner', repo: 'repo' });
  });

  it('preserves valid case, dots, underscores, and hyphens', () => {
    expect(parseRepositoryUrl('https://github.com/An-Owner/Repo_name.v2')).toEqual({ owner: 'An-Owner', repo: 'Repo_name.v2' });
  });

  it.each([
    '', 'http://github.com/owner/repo', 'ftp://github.com/owner/repo',
    'https://example.com/owner/repo', 'https://github.com.evil.test/owner/repo',
    'https://gіthub.com/owner/repo', 'https://github.com./owner/repo',
    'https://user:secret@github.com/owner/repo', 'https://github.com:443/owner/repo',
    'https://github.com:8443/owner/repo', 'https://github.com/owner/repo?',
    'https://github.com/owner/repo?x=1', 'https://github.com/owner/repo#',
    'https://github.com/owner/repo#readme', 'https://github.com/owner/repo/tree/main',
    'https://github.com//repo', 'https://github.com/owner/',
    'https://github.com/./repo', 'https://github.com/../repo',
    'https://github.com/owner/.', 'https://github.com/owner/..',
    'https://github.com/owner/.git', 'https://github.com/-owner/repo',
    'https://github.com/owner-/repo', 'https://github.com/owner/repo//',
    'https://github.com/ow%2fner/repo', 'https://github.com/owner/re%5Cpo',
    'https://github.com/owner/%2e%2e', 'https://github.com/owner/re%252fpo',
    'https://github.com/owner/repo\\other', 'https://github.com/owner/re\npo',
    'https://github.com/owner/re\u0000po', 'https://github.com/own er/repo',
    `https://github.com/${'a'.repeat(40)}/repo`,
    `https://github.com/owner/${'a'.repeat(101)}`,
    null, undefined, 123, {}, ['https://github.com/owner/repo'],
  ])('rejects suspicious input: %s', (url) => {
    expect(() => parseRepositoryUrl(url)).toThrow('https://github.com/owner/repo');
  });
});
