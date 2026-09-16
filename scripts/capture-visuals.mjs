import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const captureRoot = path.join(process.env.RUNNER_TEMP || root, 'portfolio-captures');
await mkdir(captureRoot, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
const base = 'http://127.0.0.1:8765';
let browser;
try {
  for (let n = 0; n < 50; n++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 320 }, deviceScaleFactor: 1 });
  const images = [];
  async function emitImage(name, buffer) {
    await writeFile(path.join(captureRoot, name + '.png'), buffer);
    console.log('PORTFOLIO_IMAGE ' + name + ' ' + buffer.toString('base64'));
    images.push(name);
  }
  for (const name of (await readdir('assets/headers')).filter(n => n.endsWith('.svg'))) {
    const height = name === 'profile.svg' ? 320 : 248;
    await page.setViewportSize({ width: 1200, height });
    await page.goto(base + '/assets/headers/' + name);
    const faults = await page.evaluate(() => [...document.querySelectorAll('text')].filter(el => {
      const box = el.getBBox();
      return box.x < 0 || box.y < 0 || box.x + box.width > 1200 || box.y + box.height > document.documentElement.viewBox.baseVal.height;
    }).map(el => el.textContent));
    if (faults.length) throw new Error('SVG text outside bounds: ' + name + ': ' + faults.join(', '));
    if (name === 'profile.svg' || name === 'system.svg') await emitImage(name.slice(0,-4), await page.screenshot());
    console.log('PASS header ' + name);
  }
  for (const repo of ['system', 'sysadmin-prep']) {
    const dest = path.join(root, '.capture-sites', repo);
    execFileSync('git', ['clone', '--quiet', '--depth=1', 'https://github.com/AmrAssi/' + repo + '.git', dest], { stdio: 'pipe' });
    const commit = execFileSync('git', ['-C', dest, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(base + '/.capture-sites/' + repo + '/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('h1,h2,h3').length > 2);
    await page.evaluate(() => document.fonts.ready);
    await emitImage(repo + '-desktop', await page.screenshot());
    await page.setViewportSize({ width: 390, height: 844 });
    await emitImage(repo + '-mobile', await page.screenshot());
    console.log('CAPTURED ' + repo + ' ' + commit + ' title=' + await page.title());
  }
  console.log('PORTFOLIO_CAPTURE_COMPLETE ' + images.join(','));
} finally {
  if (browser) await browser.close();
  server.kill();
}
