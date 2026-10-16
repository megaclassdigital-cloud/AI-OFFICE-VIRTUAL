#!/usr/bin/env node
// social-login.mjs — login MANUAL oleh owner ke Instagram/TikTok di PROFIL BROWSER KHUSUS autoposter (ADR-0005).
// - Chrome dibuka sebagai proses BIASA (bukan diluncurkan Playwright): tanpa spanduk "automated test software" dan tanpa penanda otomatisasi, karena
//   yang mengetik adalah manusia (owner). Platform yang melihat browser otomatis di halaman login dapat membatasi percobaan (terbukti TikTok, 16 Okt 2026).
// - Profil terpisah dari Chrome harian owner: workspace/browser-profile-social/<platform> (di D:, tidak diredirect penyimpanan virtual aplikasi Claude).
// - Skrip ini TIDAK mengetik apa pun dan TIDAK membaca kata sandi. Skrip hanya menyambung (CDP lokal) untuk memeriksa APAKAH cookie sesi ada
//   (nama cookie dan kedaluwarsa saja; nilainya tidak pernah dibaca, dicetak, atau disimpan di tempat lain).
// Pemakaian:
//   node scripts/autopost/social-login.mjs --platform instagram            (buka jendela login, tunggu sampai sesi terdeteksi)
//   node scripts/autopost/social-login.mjs --platform tiktok --timeout 900
//   node scripts/autopost/social-login.mjs --platform instagram --check    (tanpa jendela terlihat: apakah sesi masih ada?)
import '../playwright-env.mjs'; // harus pertama: arahkan Playwright ke tools/ms-playwright bila ada
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOCIAL_PROFILE_ROOT = path.join(root, 'workspace', 'browser-profile-social');

/** Konfigurasi per platform: halaman login, domain cookie, nama cookie penanda sesi masuk, dan port debug lokal. */
export const PLATFORMS = Object.freeze({
  instagram: { name: 'Instagram', loginUrl: 'https://www.instagram.com/accounts/login/', homeUrl: 'https://www.instagram.com/', domain: /(^|\.)instagram\.com$/i, sessionCookies: ['sessionid'], port: 9341 },
  tiktok: { name: 'TikTok', loginUrl: 'https://www.tiktok.com/login', homeUrl: 'https://www.tiktok.com/', domain: /(^|\.)tiktok\.com$/i, sessionCookies: ['sessionid', 'sid_tt', 'sessionid_ss'], port: 9342 },
});

export const profileDirFor = (platform) => path.join(SOCIAL_PROFILE_ROOT, platform);

/** Murni: dari daftar cookie, apakah sesi masuk ada dan belum kedaluwarsa? Hanya nama dan kedaluwarsa yang dibaca. */
export function sessionState(platform, cookies, nowSec = Date.now() / 1000) {
  const p = PLATFORMS[platform]; if (!p) return { loggedIn: false, reason: 'platform tidak dikenal' };
  const hit = (cookies ?? []).filter((c) => p.domain.test(String(c.domain ?? '').replace(/^\./, '')) && p.sessionCookies.includes(c.name));
  if (!hit.length) return { loggedIn: false, reason: 'cookie sesi tidak ada' };
  const live = hit.filter((c) => c.expires === -1 || c.expires === undefined || c.expires > nowSec);
  if (!live.length) return { loggedIn: false, reason: 'sesi kedaluwarsa' };
  const exp = Math.max(...live.map((c) => (c.expires > 0 ? c.expires : 0)));
  return { loggedIn: true, expiresAt: exp > 0 ? new Date(exp * 1000).toISOString() : null };
}

/** Lokasi chrome.exe (CHROME_PATH bila diatur, lalu lokasi pemasangan biasa). */
export function findChrome(env = process.env, exists = existsSync) {
  const c = [env.CHROME_PATH, path.join(env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')];
  return c.filter(Boolean).find((p) => exists(p)) ?? null;
}

/** Argumen Chrome biasa: profil khusus + port debug lokal; TANPA --enable-automation. headless hanya untuk --check. */
export function chromeArgs({ dir, port, url, headless }) {
  return [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', '--window-size=1200,900', ...(headless ? ['--headless=new'] : []), url];
}

async function connect(port, timeoutMs = 30000) {
  const t0 = Date.now(); let last;
  while (Date.now() - t0 < timeoutMs) {
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 800)); }
  }
  throw new Error(`tidak bisa tersambung ke Chrome (port ${port}): ${String(last?.message ?? last).slice(0, 80)}`);
}

async function closeChrome(browser, child) {
  try { const s = await browser.newBrowserCDPSession(); await s.send('Browser.close'); } catch { /* sudah tertutup */ }
  await new Promise((r) => setTimeout(r, 1500));
  try { if (child && child.exitCode === null) child.kill(); } catch { /* sudah mati */ }
}

export async function main(argv) {
  const get = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const platform = get('--platform', null);
  if (!PLATFORMS[platform]) { console.error(`Pakai: --platform ${Object.keys(PLATFORMS).join('|')} [--check] [--timeout 600]`); return 1; }
  const P = PLATFORMS[platform];
  const check = argv.includes('--check');
  const timeoutS = Number(get('--timeout', '600'));
  const chrome = findChrome();
  if (!chrome) { console.error('chrome.exe tidak ditemukan. Pasang Google Chrome atau atur CHROME_PATH.'); return 1; }
  const dir = profileDirFor(platform);
  mkdirSync(dir, { recursive: true });
  const startUrl = get('--url', null) ?? (check ? P.homeUrl : P.loginUrl); // --url: mis. halaman kode QR TikTok (https://www.tiktok.com/login/qrcode)
  const child = spawn(chrome, chromeArgs({ dir, port: P.port, url: startUrl, headless: check }), { stdio: 'ignore', windowsHide: check });
  child.on('error', (e) => console.error(`gagal membuka Chrome: ${e.message}`));
  let browser;
  try {
    browser = await connect(P.port);
    const ctx = browser.contexts()[0];
    if (check) {
      await new Promise((r) => setTimeout(r, 3000));
      const s = sessionState(platform, await ctx.cookies());
      console.log(`${P.name}: ${s.loggedIn ? `sesi MASUK${s.expiresAt ? ` (cookie berlaku sampai ${s.expiresAt.slice(0, 10)})` : ''}` : `BELUM masuk (${s.reason})`}`);
      return s.loggedIn ? 0 : 2;
    }
    console.log(`Jendela Chrome khusus terbuka. Login ${P.name} DI JENDELA ITU (ketik sendiri, termasuk kode 2FA bila diminta). Saya hanya menunggu sampai sesi terdeteksi (maks ${timeoutS} dtk) dan tidak membaca kata sandi.`);
    const t0 = Date.now(); let ok = false;
    while (Date.now() - t0 < timeoutS * 1000) {
      await new Promise((r) => setTimeout(r, 2000));
      if (child.exitCode !== null) break; // owner menutup jendela
      if (sessionState(platform, await ctx.cookies().catch(() => [])).loggedIn) { ok = true; break; }
    }
    if (ok) await new Promise((r) => setTimeout(r, 4000)); // beri waktu halaman menulis cookie lain (mis. dialog "simpan info login")
    console.log(ok ? `Sesi ${P.name} tersimpan di ${path.relative(root, dir)}. Jendela ditutup.` : 'Waktu habis atau jendela ditutup tanpa sesi masuk; tidak ada yang dicatat sebagai berhasil.');
    return ok ? 0 : 2;
  } finally {
    if (browser) await closeChrome(browser, child); else { try { child.kill(); } catch { /* abaikan */ } }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message ?? e); process.exit(1); });
}

/**
 * Buka Chrome biasa dengan profil khusus platform dan sambungkan Playwright lewat CDP lokal (tanpa penanda otomatisasi).
 * Mengembalikan { browser, ctx, page, close() }. headless=false menampilkan jendela (dry-run pertama sebaiknya terlihat).
 */
export async function openSocialChrome(platform, { headless = false, url = null } = {}) {
  const P = PLATFORMS[platform]; if (!P) throw new Error(`platform tidak dikenal: ${platform}`);
  const chrome = findChrome(); if (!chrome) throw new Error('chrome.exe tidak ditemukan');
  const dir = profileDirFor(platform); mkdirSync(dir, { recursive: true });
  const child = spawn(chrome, chromeArgs({ dir, port: P.port, url: url ?? P.homeUrl, headless }), { stdio: 'ignore', windowsHide: headless });
  const browser = await connect(P.port);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => /^https?:/.test(p.url())) ?? ctx.pages()[0] ?? (await ctx.newPage());
  return { browser, ctx, page, child, close: () => closeChrome(browser, child) };
}
