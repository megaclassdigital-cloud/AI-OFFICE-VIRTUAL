#!/usr/bin/env node
// ui-shot.mjs — headless screenshot of the Office View for visual review (no browser pane needed).
// Usage: node scripts/ui-shot.mjs <out.png> [--url http://127.0.0.1:3190/] [--w 1366] [--h 768] [--click "x,y"] [--eval "js"] [--wait 2500]
import './playwright-env.mjs'; // harus pertama: arahkan Playwright ke tools/ms-playwright bila ada
import { chromium } from 'playwright';
import path from 'node:path';

const a = process.argv.slice(2);
const out = path.resolve(a[0] ?? 'ui-shot.png');
const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const url = arg('--url', 'http://127.0.0.1:3190/');
const w = Number(arg('--w', 1366)); const h = Number(arg('--h', 768));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(Number(arg('--wait', 2500)));
  const click = arg('--click');
  if (click) { const [x, y] = click.split(',').map(Number); await page.mouse.click(x, y); await page.waitForTimeout(1500); }
  const ev = arg('--eval');
  if (ev) { console.log('eval:', JSON.stringify(await page.evaluate(ev))); await page.waitForTimeout(800); }
  await page.screenshot({ path: out });
  console.log(`ok ${out}${errors.length ? ' | console errors: ' + errors.join(' || ') : ''}`);
} finally { await browser.close(); }
