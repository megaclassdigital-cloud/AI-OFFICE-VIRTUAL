#!/usr/bin/env node
// run.mjs — pintu masuk autoposter (ADR-0005). Pada fase P2 HANYA dry-run: mengisi halaman unggah sampai tepat sebelum klik final, menyimpan bukti,
// mencatat ke ledger, dan membuang draf. Mode live sengaja belum tersedia (P5, atas keputusan owner).
// Pemakaian: node scripts/autopost/run.mjs --platform instagram --content EDU-97 [--headless]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync, mkdirSync } from 'node:fs';
import { readJsonSafe, writeJsonAtomic } from '../safe-json.mjs';
import { mergeAutopostSettings } from './guards.mjs';
import { buildPackage } from './package.mjs';
import { openSocialChrome, sessionState, PLATFORMS } from './social-login.mjs';
import { dryRunInstagram } from './instagram.mjs';
import { dryRunTikTok } from './tiktok.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'workspace', 'agent');
const DIR = path.join(OUT, 'autopost');
const LOG = path.join(ROOT, 'reports', 'autopost.log');
const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); try { mkdirSync(path.dirname(LOG), { recursive: true }); appendFileSync(LOG, l + '\n'); } catch { /* kosmetik */ } };

export const FLOWS = { instagram: dryRunInstagram, tiktok: dryRunTikTok };

export async function main(argv) {
  const get = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const platform = get('--platform', null); const content = get('--content', null);
  if (!PLATFORMS[platform] || !/^EDU-[0-9]+$/.test(content ?? '')) { console.error('Pakai: --platform instagram|tiktok --content EDU-<n> [--headless]'); return 1; }
  if (argv.includes('--live')) { log('DITOLAK: mode live belum tersedia pada fase ini (P5, atas keputusan owner setelah dry-run ditinjau)'); return 3; }
  if (!FLOWS[platform]) { log(`DITOLAK: alur ${platform} belum dibangun`); return 1; }
  const settings = mergeAutopostSettings(readJsonSafe(path.join(DIR, 'settings.json'), {}));
  if (settings.paused) { log('DITOLAK: kill switch aktif (paused)'); return 3; }
  const pkg = buildPackage(OUT, content);
  if (pkg.errors.length) { log(`DITOLAK: paket ${content} tidak valid: ${pkg.errors.join('; ')}`); return 2; }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const evidenceDir = path.join(DIR, 'evidence', content, platform, ts);
  const entry = { content, platform, mode: 'dry-run', at: new Date().toISOString(), runKey: pkg.runKey, evidenceDir: path.relative(ROOT, evidenceDir) };
  const s = await openSocialChrome(platform, { headless: argv.includes('--headless') });
  try {
    const st = sessionState(platform, await s.ctx.cookies());
    if (!st.loggedIn) throw new Error(`sesi ${platform} tidak masuk (${st.reason}); jalankan social-login.mjs --platform ${platform}`);
    log(`dry-run ${platform} untuk ${pkg.runKey}: ${pkg.slides.length} slide, caption ${pkg.captionFull.length} karakter`);
    const r = await FLOWS[platform]({ page: s.page, pkg, evidenceDir, log });
    log(`SELESAI dry-run ${platform}: berhenti sebelum ${r.stoppedBefore}; bukti di ${entry.evidenceDir}`);
    entry.status = 'dry_run_ok'; Object.assign(entry, { slides: r.slides, captionChars: r.captionChars });
    return 0;
  } catch (e) {
    log(`GAGAL dry-run ${platform}: ${e.message}`);
    entry.status = 'dry_run_gagal'; entry.error = String(e.message).slice(0, 240);
    return 2;
  } finally {
    await s.close();
    const ledgerFile = path.join(DIR, 'ledger.json');
    const ledger = readJsonSafe(ledgerFile, []) ?? [];
    ledger.push(entry); mkdirSync(DIR, { recursive: true }); writeJsonAtomic(ledgerFile, ledger.slice(-300));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message ?? e); process.exit(1); });
}
