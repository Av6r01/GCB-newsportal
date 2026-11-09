import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
process.env.NODE_ENV = 'development';
process.env.DB_DRIVER = 'json';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'screenshots', process.argv[2] || 'before');

fs.mkdirSync(OUT_DIR, { recursive: true });

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function capture(url: string, outName: string, width: number, height: number) {
  const outFile = path.join(OUT_DIR, outName);
  console.log(`Capturing ${outName} (${width}x${height}) from ${url}...`);
  execSync(
    `"${CHROME}" --headless=new --screenshot="${outFile}" --window-size=${width},${height} --hide-scrollbars --disable-gpu "${url}"`,
    { stdio: 'ignore', timeout: 15000 }
  );
  if (fs.existsSync(outFile)) {
    console.log(`  ✓ Saved ${outFile}`);
  } else {
    console.error(`  ✗ Failed to save ${outFile}`);
  }
}

async function main() {
  const { buildServer } = await import('../server.ts');
  const built = await buildServer({ lifespan: false, static: true });
  const server = http.createServer(built.app);

  await new Promise<void>((resolve) => server.listen(3333, '127.0.0.1', resolve));
  console.log('App running on http://127.0.0.1:3333');

  try {
    // Wait 1s for server readiness
    await sleep(1000);

    const baseUrl = 'http://127.0.0.1:3333';

    // 1. Home
    await capture(`${baseUrl}/`, 'home-desktop.png', 1440, 900);
    await capture(`${baseUrl}/`, 'home-tablet.png', 768, 1024);
    await capture(`${baseUrl}/`, 'home-mobile.png', 390, 844);

    // 2. Article Detail
    const articleSlug = 'global-climate-summit-reaches-landmark-accord';
    await capture(`${baseUrl}/article/${articleSlug}`, 'article-desktop.png', 1440, 900);
    await capture(`${baseUrl}/article/${articleSlug}`, 'article-mobile.png', 390, 844);

    // 3. Category Page
    await capture(`${baseUrl}/category/world`, 'category-desktop.png', 1440, 900);

    // 4. Admin Login
    await capture(`${baseUrl}/admin`, 'admin-login-desktop.png', 1440, 900);

    console.log('\nAll captures complete in:', OUT_DIR);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
