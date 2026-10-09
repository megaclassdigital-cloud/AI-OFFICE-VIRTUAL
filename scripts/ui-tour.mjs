#!/usr/bin/env node
// ui-tour.mjs — headless tour of the TV dashboard: one screenshot per tab (for visual review). Usage: node scripts/ui-tour.mjs <outDir> [--w 1366 --h 768]
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
const a = process.argv.slice(2);
const out = path.resolve(a[0] ?? 'ui-tour');
const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: Number(arg('--w', 1366)), height: Number(arg('--h', 768)) } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)));
  await page.goto('http://127.0.0.1:3190/', { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  await page.click('#dock .x'); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '00-peta.png') });
  await page.click('#bTV'); await page.waitForTimeout(3500);
  for (const tab of ['show', 'manager', 'researcher', 'verifier', 'copywriter', 'designer', 'qa']) {
    await page.click(`#tv [data-tab="${tab}"]`); await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, `tv-${tab}.png`) });
  }
  console.log('ok ' + out + (errors.length ? ' | errors: ' + [...new Set(errors)].join(' || ') : ''));
} finally { await browser.close(); }
