#!/usr/bin/env node
// make-placeholder-assets.mjs — generates abstract, original placeholder hero images for layout tests ONLY.
// NOT real assets: real heroes come from the Asset stage (screenshots of real images / brand marks).
// Usage: node scripts/make-placeholder-assets.mjs <outDir> [--accent "#14D9F5"]
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const a = process.argv.slice(2);
const out = path.resolve(a[0] ?? 'placeholder-assets');
const accent = a.includes('--accent') ? a[a.indexOf('--accent') + 1] : '#14D9F5';
mkdirSync(out, { recursive: true });
const variants = {
  'hero-a': `radial-gradient(500px 360px at 70% 40%, ${accent}88, transparent 70%), repeating-linear-gradient(0deg, #ffffff10 0 2px, transparent 2px 46px), repeating-linear-gradient(90deg, #ffffff10 0 2px, transparent 2px 46px), #070510`,
  'hero-b': `radial-gradient(420px 420px at 50% 55%, ${accent}aa, transparent 68%), radial-gradient(900px 300px at 50% 100%, ${accent}44, transparent 70%), #05040c`,
  'hero-c': `linear-gradient(160deg, #0a0716 30%, ${accent}66 100%), repeating-linear-gradient(60deg, #ffffff0c 0 2px, transparent 2px 60px), #05040c`,
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 700 } });
  for (const [name, bg] of Object.entries(variants)) {
    await page.setContent(`<body style="margin:0;width:1080px;height:700px;background:${bg}"></body>`);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
  }
  console.log(`ok ${out}`);
} finally { await browser.close(); }
