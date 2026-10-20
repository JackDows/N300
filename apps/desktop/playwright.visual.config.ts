import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir:'tests/visual',workers:1,timeout:60000,
  use:{channel:'msedge',baseURL:process.env.DESKHUB_VISUAL_URL??'http://127.0.0.1:1420',viewport:{width:1440,height:900}},
  outputDir:'../../artifacts/visual/test-results',
  reporter:[['list'],['json',{outputFile:'../../artifacts/visual/validation.json'}]],
  webServer:process.env.DESKHUB_VISUAL_URL?undefined:{command:'npm run dev -- --host 127.0.0.1',url:'http://127.0.0.1:1420/visual.html',reuseExistingServer:!process.env.CI},
});
