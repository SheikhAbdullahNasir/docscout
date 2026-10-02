import { expect, test } from '@playwright/test';

test('health proxy and keyboard form work without analysis or AI requests', async ({ page, request }) => {
  expect((await request.get('/api/health')).status()).toBe(200);
  const outbound: string[] = [];
  page.on('request', (req) => outbound.push(req.url()));
  await page.goto('/');
  const input = page.getByLabel('GitHub repository URL');
  await input.fill('https://example.com/owner/repo');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('https://github.com/owner/repo');
  await input.fill('https://github.com/owner/repo');
  await input.press('Enter');
  await expect(page.getByRole('status')).toContainText('Repository scanning arrives in Phase 1');
  expect(outbound.every((url) => url.startsWith('http://127.0.0.1:5173/'))).toBe(true);
  expect(outbound.some((url) => /\/api\/(analyze|explain)/.test(url))).toBe(false);
});

for (const width of [360, 1280]) {
  test(`form fits a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
