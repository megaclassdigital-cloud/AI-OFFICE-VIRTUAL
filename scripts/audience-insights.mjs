#!/usr/bin/env node
// audience-insights.mjs — membaca performa posting akun (TikTok Studio > Content: views, like, komentar per posting) menjadi profil audiens.
// BACA-SAJA: tidak ada klik aksi, tidak mengubah apa pun di akun. Memakai Chrome sosial yang sudah login (profil khusus) dan kunci browser
// bersama Admin Publikasi (tidak berjalan saat posting). Hasil: workspace/agent/autonomy/insights.json. Instagram: belum (insight web tidak stabil).
// Pemakaian: node scripts/audience-insights.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { writeJsonAtomic } from './safe-json.mjs';
import { openSocialChrome, sessionState } from './autopost/social-login.mjs';
import { acquireBrowser, releaseBrowser, browserHolder } from './autopost/browser-lock.mjs';
import { parseTikTokContent, analyzeInsights } from './autonomy-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const INSIGHTS_FILE = path.join(ROOT, 'workspace', 'agent', 'autonomy', 'insights.json');
const CONTENT_URL = 'https://www.tiktok.com/tiktokstudio/content';
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

export async function refreshInsights() {
  if (!acquireBrowser('insights')) { log(`Chrome sosial dipakai ${browserHolder()}; analitik ditunda`); return { ok: false, reason: 'browser-dipakai' }; }
  let s = null;
  try {
    s = await openSocialChrome('tiktok', { headless: false, offscreen: true, url: CONTENT_URL });
    const st = sessionState('tiktok', await s.ctx.cookies());
    if (!st.loggedIn) return { ok: false, reason: `sesi TikTok tidak masuk (${st.reason})` };
    const page = s.page;
    if (!/tiktokstudio\/content/.test(page.url())) await page.goto(CONTENT_URL, { waitUntil: 'domcontentloaded' });
    let text = ''; const t0 = Date.now();
    while (Date.now() - t0 < 60000) { text = await page.evaluate(() => document.body.innerText).catch(() => ''); if (/Views/.test(text) && /Posts\s+\d+/.test(text)) break; await page.waitForTimeout(2000); }
    const posts = parseTikTokContent(text);
    if (!posts.length) return { ok: false, reason: 'tidak ada posting yang terbaca (halaman belum termuat atau antarmuka berubah)' };
    const analysis = analyzeInsights(posts);
    mkdirSync(path.dirname(INSIGHTS_FILE), { recursive: true });
    writeJsonAtomic(INSIGHTS_FILE, { at: Date.now(), source: 'tiktok-studio/content', posts, analysis });
    return { ok: true, posts: posts.length, analysis };
  } catch (e) { return { ok: false, reason: String(e.message).split('\n')[0].slice(0, 200) }; }
  finally { try { await s?.close(); } catch { /* sudah tertutup */ } releaseBrowser('insights'); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await refreshInsights();
  log(r.ok ? `analitik diperbarui: ${r.posts} posting. ${r.analysis.notes.join(' ')}` : `analitik GAGAL: ${r.reason}`);
  process.exit(r.ok ? 0 : 1);
}
