#!/usr/bin/env node
// browser-login.mjs — membuka jendela Edge (terlihat) dengan PROFIL TERSIMPAN agar OWNER menyelesaikan CAPTCHA/login mesin pencari sendiri.
// Kode tidak menyentuh CAPTCHA. Setelah owner lolos, cookie tersimpan di profil dan dipakai ulang oleh capture-asset.mjs.
// Pemakaian: node scripts/browser-login.mjs [--engine google|bing] [--timeout 600]
import './playwright-env.mjs'; // harus pertama: arahkan Playwright ke tools/ms-playwright bila ada
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROFILE_DIR = path.join(root, 'workspace', 'browser-profile');

const URLS = {
  google: 'https://www.google.com/search?tbm=isch&hl=id&q=Anthropic+Claude+logo',
  bing: 'https://www.bing.com/images/search?q=Anthropic+Claude+logo',
};

export async function main(argv) {
  const get = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const engine = get('--engine', 'google');
  const timeoutS = Number(get('--timeout', '600'));
  mkdirSync(PROFILE_DIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'msedge', headless: false, locale: 'id-ID', viewport: null, args: ['--window-size=1200,900'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(URLS[engine] ?? URLS.google, { waitUntil: 'domcontentloaded' });
  console.log(`Jendela Edge terbuka. Selesaikan verifikasi/login ${engine} di jendela itu sendiri; saya menunggu sampai hasil gambar tampil (maks ${timeoutS} dtk).`);
  const t0 = Date.now(); let ok = false;
  while (Date.now() - t0 < timeoutS * 1000) {
    await page.waitForTimeout(2000);
    const url = page.url();
    const imgs = await page.$$eval('img', (is) => is.filter((i) => i.getBoundingClientRect().width > 100).length).catch(() => 0);
    if (!/\/sorry\//.test(url) && imgs >= 6) { ok = true; break; }
  }
  await ctx.close();
  console.log(ok ? 'Sesi tersimpan di workspace/browser-profile. capture-asset sekarang memakainya.' : 'Waktu habis tanpa hasil gambar; sesi tidak dianggap lolos.');
  return ok ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
}
