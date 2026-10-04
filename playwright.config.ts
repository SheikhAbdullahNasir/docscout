import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium' },
  webServer: [
    {
      command: 'npm run build -w @docscout/server && npm start -w @docscout/server',
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: 'npm run dev -w @docscout/web',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
