/**
 * Renders the link preview image and the app icons from the HTML files next to this script.
 * Needs Playwright with Chromium and a local server at the project root:
 *   python3 -m http.server 8000   then   node tools/brand/render.mjs
 * Not part of `npm test`; run it only when the preview or the icons change.
 */
import { createRequire } from 'node:module';

const require = createRequire(process.env.PLAYWRIGHT_PATH ?? import.meta.url);
const { chromium } = require('playwright');
const BASE = 'http://localhost:8000/tools/brand/';

const browser = await chromium.launch();
const shot = async (file, size, out, type = 'png') => {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  await page.goto(BASE + file);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: out, type, ...(type === 'jpeg' ? { quality: 62 } : {}) });
  await page.close();
};
await shot('preview.html', { width: 1200, height: 630 }, 'assets/og-preview.jpg', 'jpeg');
await shot('icon.html', { width: 512, height: 512 }, 'assets/icon-512.png');
await browser.close();
console.log('Wrote assets/og-preview.jpg and assets/icon-512.png');
