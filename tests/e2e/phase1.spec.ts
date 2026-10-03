import { expect, test, type Page } from '@playwright/test';

const commitSha = '1234567890abcdef1234567890abcdef12345678';

const repository = {
  owner: 'Canonical',
  name: 'Repo',
  url: 'https://github.com/Canonical/Repo',
  private: false as const,
  archived: true,
  defaultBranch: 'release/docs',
};

const issues = {
  fetchedAt: '2026-10-04T06:30:00.000Z',
  items: [{
    number: 42,
    title: 'Clarify setup notes',
    url: 'https://github.com/Canonical/Repo/issues/42',
    labels: ['good first issue', 'documentation'],
    updatedAt: '2026-10-03T05:04:03.000Z',
    assignees: ['maintainer'],
    assigned: true,
    bodyExcerpt: 'The setup guide could explain the supported Node versions.',
  }],
  coverage: {
    complete: false,
    sampled: true,
    queries: [
      {
        label: 'good first issue' as const,
        status: 'complete' as const,
        pagesFetched: 2,
        capped: true,
        message: 'Issue results sampled because another page was available after the two-page limit.',
      },
      {
        label: 'help wanted' as const,
        status: 'failed' as const,
        pagesFetched: 0,
        capped: false,
        message: 'Issue coverage for this label is unavailable because GitHub could not complete the request.',
      },
    ],
  },
};

const successResponse = {
  schemaVersion: 1 as const,
  repository,
  status: 'ready' as const,
  snapshot: {
    defaultBranch: 'release/docs',
    commitSha,
    treeSha: 'abcdef1234567890abcdef1234567890abcdef12',
    tree: { entries: [], truncated: true, complete: false },
    documents: {
      selectionComplete: false,
      readme: {
        status: 'available' as const,
        document: {
          path: 'README.md',
          category: 'readme' as const,
          sourceUrl: `https://github.com/Canonical/Repo/blob/${commitSha}/README.md`,
          text: '# Welcome\n<img src="https://tracker.invalid/pixel.png">',
          sha: 'a'.repeat(40),
          decodedSize: 56,
          reportedSize: 56,
        },
      },
      contributing: {
        status: 'available' as const,
        document: {
          path: '.github/CONTRIBUTING.md',
          category: 'contributing' as const,
          sourceUrl: `https://github.com/Canonical/Repo/blob/${commitSha}/.github/CONTRIBUTING.md`,
          text: 'Please discuss substantial changes before opening a pull request.',
          sha: 'b'.repeat(40),
          decodedSize: 67,
          reportedSize: 67,
        },
      },
      packageJson: { status: 'unavailable' as const, message: 'No root package.json was found.' },
      docs: [],
      skipped: [{ path: 'docs/large.md', category: 'docs' as const, reason: 'oversized' as const }],
      omissions: ['docs-limit' as const],
    },
  },
  issues,
};

const emptyResponse = {
  schemaVersion: 1 as const,
  repository: { ...repository, archived: false },
  status: 'ready' as const,
  snapshot: {
    defaultBranch: 'release/docs',
    commitSha,
    treeSha: 'abcdef1234567890abcdef1234567890abcdef12',
    tree: { entries: [], truncated: false, complete: true },
    documents: {
      selectionComplete: true,
      readme: { status: 'unavailable' as const, message: 'No supported root Markdown README found.' },
      contributing: {
        status: 'unavailable' as const,
        message: 'Repository-local contribution guidance is unavailable.',
      },
      packageJson: { status: 'unavailable' as const, message: 'No root package.json was found.' },
      docs: [],
      skipped: [],
      omissions: [],
    },
  },
  issues: {
    fetchedAt: '2026-10-04T06:30:00.000Z',
    items: [],
    coverage: {
      complete: true,
      sampled: false,
      queries: [
        { label: 'good first issue' as const, status: 'complete' as const, pagesFetched: 1, capped: false },
        { label: 'help wanted' as const, status: 'complete' as const, pagesFetched: 1, capped: false },
      ],
    },
  },
};

async function submit(page: Page) {
  await page.getByLabel('GitHub repository URL').fill('https://github.com/input/repo');
  await page.getByRole('button', { name: 'Analyze repository' }).click();
}

test('displays the typed Phase 1 snapshot safely with archived and partial coverage notices', async ({ page }) => {
  let releaseResponse: (() => void) | undefined;
  const waitForRelease = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:5173/')) remoteRequests.push(request.url());
  });
  await page.route('**/api/repository/snapshot', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ repositoryUrl: 'https://github.com/input/repo' });
    await waitForRelease;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(successResponse) });
  });

  await page.goto('/');
  await submit(page);
  await expect(page.getByRole('status')).toContainText('Analyzing repository…');
  releaseResponse?.();

  await expect(page.getByRole('status')).toContainText('Repository analysis complete.');
  await expect(page.getByRole('heading', { name: 'Canonical/Repo' })).toBeVisible();
  await expect(page.getByText('Archived repository')).toBeVisible();
  await expect(page.getByText('release/docs', { exact: true })).toBeVisible();
  await expect(page.getByText('1234567890ab', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'README.md' })).toBeVisible();
  await expect(page.locator('.document-preview').first()).toContainText('<img src="https://tracker.invalid/pixel.png">');
  await expect(page.getByRole('heading', { name: 'Contribution guidance' })).toBeVisible();
  await expect(page.getByText('.github/CONTRIBUTING.md', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '#42 Clarify setup notes' })).toBeVisible();
  await expect(page.getByText('good first issue', { exact: true })).toBeVisible();
  await expect(page.getByText('Assigned to maintainer')).toBeVisible();
  await expect(page.getByText('Repository path coverage is incomplete.', { exact: true })).toBeVisible();
  await expect(page.getByText('Issue results sampled because another page was available after the two-page limit.')).toBeVisible();
  await expect(page.getByText('Issue coverage for this label is unavailable because GitHub could not complete the request.')).toBeVisible();
  await expect(page.locator('img')).toHaveCount(0);
  expect(remoteRequests).toEqual([]);
});

test('shows narrow README, contribution-guidance, and supported-issue empty states', async ({ page }) => {
  await page.route('**/api/repository/snapshot', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(emptyResponse),
  }));
  await page.goto('/');
  await submit(page);

  await expect(page.getByText('No supported root Markdown README found.')).toBeVisible();
  await expect(page.getByText('Repository-local contribution guidance was not found in the checked locations.')).toBeVisible();
  await expect(page.getByText('No open issues matched the supported good first issue/help wanted label queries.')).toBeVisible();
});

test('does not turn unavailable guidance or partial issue coverage into confirmed absence', async ({ page }) => {
  const partialResponse = {
    ...emptyResponse,
    snapshot: {
      ...emptyResponse.snapshot,
      documents: {
        ...emptyResponse.snapshot.documents,
        readme: {
          status: 'unknown' as const,
          message: 'README availability is unknown because tree path coverage is incomplete.',
        },
        contributing: {
          status: 'unavailable' as const,
          message: 'The selected contribution guidance could not be read safely at the pinned commit.',
        },
      },
    },
    issues: {
      ...emptyResponse.issues,
      coverage: {
        complete: false,
        sampled: false,
        queries: [
          {
            label: 'good first issue' as const,
            status: 'failed' as const,
            pagesFetched: 0,
            capped: false,
            message: 'Issue coverage for this label is unavailable because GitHub could not complete the request.',
          },
          { label: 'help wanted' as const, status: 'complete' as const, pagesFetched: 1, capped: false },
        ],
      },
    },
  };
  await page.route('**/api/repository/snapshot', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(partialResponse),
  }));
  await page.goto('/');
  await submit(page);

  await expect(page.getByText('The selected contribution guidance could not be read safely at the pinned commit.')).toBeVisible();
  await expect(page.getByText('README availability is unknown because tree path coverage is incomplete.')).toBeVisible();
  await expect(page.getByText('Repository-local contribution guidance was not found in the checked locations.')).toHaveCount(0);
  await expect(page.getByText('No issue records were returned from the available supported label coverage.')).toBeVisible();
  await expect(page.getByText('No open issues matched the supported good first issue/help wanted label queries.')).toHaveCount(0);
});

test('does not describe skipped contribution guidance as absent', async ({ page }) => {
  const skippedGuidanceResponse = {
    ...emptyResponse,
    snapshot: {
      ...emptyResponse.snapshot,
      documents: {
        ...emptyResponse.snapshot.documents,
        skipped: [{ path: 'CONTRIBUTING.md', category: 'contributing' as const, reason: 'symlink' as const }],
      },
    },
  };
  await page.route('**/api/repository/snapshot', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(skippedGuidanceResponse),
  }));
  await page.goto('/');
  await submit(page);

  await expect(page.getByText('Repository-local contribution guidance is unavailable.')).toBeVisible();
  await expect(page.getByText('Repository-local contribution guidance was not found in the checked locations.')).toHaveCount(0);
});

test('shows an empty repository snapshot without losing retained issue coverage', async ({ page }) => {
  const response = {
    schemaVersion: 1 as const,
    repository: { ...repository, archived: false },
    status: 'empty' as const,
    snapshot: null,
    message: 'This repository has no commit snapshot or files to scan yet.',
    issues: { ...issues, coverage: { ...issues.coverage, complete: true, sampled: false } },
  };
  await page.route('**/api/repository/snapshot', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(response),
  }));
  await page.goto('/');
  await submit(page);

  await expect(page.getByText('This repository has no commit snapshot or files to scan yet.')).toBeVisible();
  await expect(page.getByText('No document snapshot is available because this repository has no commit to scan.')).toBeVisible();
  await expect(page.getByRole('heading', { name: '#42 Clarify setup notes' })).toBeVisible();
});

test('rejects invalid repository input without sending a scan request', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/repository/snapshot', async (route) => {
    requests += 1;
    await route.abort();
  });
  await page.goto('/');
  await page.getByLabel('GitHub repository URL').fill('https://example.com/owner/repo');
  await page.getByRole('button', { name: 'Analyze repository' }).click();

  await expect(page.getByRole('alert')).toContainText('https://github.com/owner/repo');
  expect(requests).toBe(0);
});

test('shows a safe server error without exposing internal fields', async ({ page }) => {
  await page.route('**/api/repository/snapshot', (route) => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({
      error: {
        code: 'REPOSITORY_UNAVAILABLE',
        message: 'Repository unavailable. Check the URL; it may be private or missing.',
      },
      requestId: 'request-123',
      stack: 'secret stack',
      token: 'secret token',
    }),
  }));
  await page.goto('/');
  await submit(page);

  await expect(page.getByRole('alert')).toContainText('Repository unavailable. Check the URL; it may be private or missing.');
  await expect(page.getByText('secret stack')).toHaveCount(0);
  await expect(page.getByText('secret token')).toHaveCount(0);
});

test('shows a safe error for a malformed successful response', async ({ page }) => {
  await page.route('**/api/repository/snapshot', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ schemaVersion: 1, status: 'ready' }),
  }));
  await page.goto('/');
  await submit(page);

  await expect(page.getByRole('alert')).toContainText('Repository analysis returned an invalid response. Please try again later.');
});
