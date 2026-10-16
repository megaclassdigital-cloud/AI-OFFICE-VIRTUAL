#!/usr/bin/env node
// social-login.mjs — login MANUAL oleh owner ke Instagram/TikTok di PROFIL BROWSER KHUSUS autoposter (ADR-0005).
// - Profil terpisah dari Chrome harian owner: workspace/browser-profile-social/<platform> (di D:, tidak diredirect penyimpanan virtual aplikasi Claude).
// - Skrip ini TIDAK mengetik apa pun dan TIDAK membaca kata sandi. Owner mengetik sendiri (termasuk 2FA). Skrip hanya memeriksa APAKAH cookie sesi ada
//   (nama cookie saja; nilainya tidak pernah dibaca, dicetak, atau disimpan di tempat lain).
// Pemakaian:
//   node scripts/autopost/social-login.mjs --platform instagram            (buka jendela login, tunggu sampai sesi terdeteksi)
//   node scripts/autopost/social-login.mjs --platform tiktok --timeout 900
//   node scripts/autopost/social-login.mjs --platform instagram --check    (tanpa jendela: apakah sesi masih ada?)
import '../playwright-env.mjs'; // harus pertama: arahkan Playwright ke tools/ms-playwright bila ada
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOCIAL_PROFILE_ROOT = path.join(root, 'workspace', 'browser-profile-social');

/** Konfigurasi per platform: halaman login, domain cookie, dan nama cookie yang menandakan sesi masuk. */
export const PLATFORMS = Object.freeze({
  instagram: { name: 'Instagram', loginUrl: 'https://www.instagram.com/accounts/login/', homeUrl: 'https://www.instagram.com/', domain: /(^|\.)instagram\.com$/i, sessionCookies: ['sessionid'] },
  tiktok: { name: 'TikTok', loginUrl: 'https://www.tiktok.com/login', homeUrl: 'https://www.tiktok.com/', domain: /(^|\.)tiktok\.com$/i, sessionCookies: ['sessionid', 'sid_tt', 'sessionid_ss'] },
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

async function launch(profileDir, headless) {
  const base = { headless, locale: 'id-ID', viewport: headless ? { width: 1280, height: 900 } : null, args: headless ? [] : ['--window-size=1200,900'] };
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launchPersistentContext(profileDir, { ...base, channel }); } catch { /* coba saluran berikutnya */ }
  }
  return chromium.launchPersistentContext(profileDir, base); // Chromium bawaan sebagai terakhir
}

export async function main(argv) {
  const get = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const platform = get('--platform', null);
  if (!PLATFORMS[platform]) { console.error(`Pakai: --platform ${Object.keys(PLATFORMS).join('|')} [--check] [--timeout 600]`); return 1; }
  const check = argv.includes('--check');
  const timeoutS = Number(get('--timeout', '600'));
  const dir = profileDirFor(platform);
  mkdirSync(dir, { recursive: true });
  const ctx = await launch(dir, check);
  try {
    if (check) {
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(PLATFORMS[platform].homeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      const s = sessionState(platform, await ctx.cookies());
      console.log(`${PLATFORMS[platform].name}: ${s.loggedIn ? `sesi MASUK${s.expiresAt ? ` (cookie berlaku sampai ${s.expiresAt.slice(0, 10)})` : ''}` : `BELUM masuk (${s.reason})`}`);
      return s.loggedIn ? 0 : 2;
    }
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(PLATFORMS[platform].loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    console.log(`Jendela browser khusus terbuka. Login ${PLATFORMS[platform].name} DI JENDELA ITU (ketik sendiri, termasuk kode 2FA bila diminta). Saya hanya menunggu sampai sesi terdeteksi (maks ${timeoutS} dtk) dan tidak membaca kata sandi.`);
    const t0 = Date.now(); let ok = false;
    while (Date.now() - t0 < timeoutS * 1000) {
      await new Promise((r) => setTimeout(r, 2000));
      if (sessionState(platform, await ctx.cookies().catch(() => [])).loggedIn) { ok = true; break; }
    }
    if (ok) { await new Promise((r) => setTimeout(r, 4000)); } // beri waktu halaman menulis cookie lain (mis. dialog "simpan info login")
    console.log(ok ? `Sesi ${PLATFORMS[platform].name} tersimpan di ${path.relative(root, dir)}. Jendela ditutup.` : 'Waktu habis tanpa sesi masuk; tidak ada yang disimpan sebagai berhasil.');
    return ok ? 0 : 2;
  } finally { await ctx.close().catch(() => {}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
}
