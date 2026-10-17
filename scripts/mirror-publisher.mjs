#!/usr/bin/env node
// mirror-publisher.mjs — mendorong salinan BERSIH (tanpa jalur lokal/rahasia/id internal) keadaan kantor ke monitor kedua di Vercel.
// Prinsip: tidak boleh mengganggu pekerjaan agen. Hanya MEMBACA (GET ke Office View lokal; tidak pernah menulis ke Paperclip/orkestrator/agen),
// berjalan sebagai proses terpisah dengan prioritas rendah, permintaan berurutan dengan jeda, jadwal melambat saat sepi, berhenti sejenak bila RAM menipis.
// Pemakaian: node scripts/mirror-publisher.mjs [--watch] [--once] [--dry-run] [--status]
// Konfigurasi di .env: MIRROR_URL (https://<proyek>.vercel.app), MIRROR_INGEST_SECRET. Pengaturan: workspace/mirror/settings.json (enabled, maxProd).
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonSafe, writeJsonAtomic } from './safe-json.mjs';
import { sanitizeForMirror } from '../apps/office-view/gate.mjs';
import { hashOf, findImagePaths, mergeEvents, intervals, prodDue, memoryOk, ACTIVE_STATUS } from './mirror/plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'workspace', 'mirror');
const STATE_FILE = path.join(DIR, 'state.json');
const SETTINGS_FILE = path.join(DIR, 'settings.json');
const LOCAL = process.env.MIRROR_LOCAL ?? 'http://127.0.0.1:3190';
const AGENTS = ['Manager', 'Researcher', 'Verifier', 'Copywriter', 'Designer', 'QA'];
const argv = process.argv.slice(2); const has = (f) => argv.includes(f);
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readEnv() {
  const vals = {};
  try { for (const l of readFileSync(path.join(ROOT, '.env'), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) { const m = /^(MIRROR_URL|MIRROR_INGEST_SECRET)=(.*)$/.exec(l); if (m) vals[m[1]] = m[2].trim(); } } catch { /* belum ada .env */ }
  return { MIRROR_URL: process.env.MIRROR_URL ?? vals.MIRROR_URL, MIRROR_INGEST_SECRET: process.env.MIRROR_INGEST_SECRET ?? vals.MIRROR_INGEST_SECRET };
}

export function createPublisher({ fetchImpl = fetch, now = Date.now, freemem = () => os.freemem(), env = readEnv, dryRun = false, gapMs = 250, readImage = null, persist = true } = {}) {
  const st = { ring: null, hashes: {}, images: {}, last: {}, itemHash: {}, board: null, working: false, sentBytes: 0, stats: { uploaded: 0, skipped: 0, failed: 0 } };
  const saved = persist ? readJsonSafe(STATE_FILE, null) : null; if (saved) { st.hashes = saved.hashes ?? {}; st.images = saved.images ?? {}; }
  const due = (name, ms) => now() - (st.last[name] ?? 0) >= ms;
  const mark = (name) => { st.last[name] = now(); };

  async function local(route, accept = 'json') {
    const r = await fetchImpl(LOCAL + route, { signal: AbortSignal.timeout(25_000) });
    if (!r.ok) throw new Error(`${route} -> ${r.status}`);
    return accept === 'json' ? r.json() : Buffer.from(await r.arrayBuffer());
  }
  async function upload(key, body, contentType) {
    const { MIRROR_URL: url, MIRROR_INGEST_SECRET: secret } = env();
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body), 'utf8');
    if (dryRun) { st.stats.uploaded += 1; st.sentBytes += buf.length; return true; }
    if (!url || !secret) throw new Error('MIRROR_URL / MIRROR_INGEST_SECRET belum diatur di .env');
    const r = await fetchImpl(`${url.replace(/\/$/, '')}/api/ingest?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'x-ingest-secret': secret, 'content-type': contentType, 'content-length': String(buf.length) }, body: buf, signal: AbortSignal.timeout(40_000) });
    if (!r.ok) throw new Error(`unggah ${key} -> ${r.status} ${(await r.text()).slice(0, 80)}`);
    st.sentBytes += buf.length; return true;
  }
  /** Unggah dokumen JSON hanya bila isinya berubah sejak unggahan sukses terakhir. */
  async function publish(key, route, body) {
    const clean = sanitizeForMirror(route, body); const h = hashOf(clean);
    if (st.hashes[key] === h) { st.stats.skipped += 1; return clean; }
    try { await upload(key, clean, 'application/json'); st.hashes[key] = h; st.stats.uploaded += 1; }
    catch (e) { st.stats.failed += 1; log(`GAGAL ${e.message}`); }
    await sleep(gapMs); return clean;
  }
  async function guarded(name, fn) { try { return await fn(); } catch (e) { log(`${name}: ${String(e.message).slice(0, 140)}`); return null; } }

  /** Satu siklus. Mengembalikan ringkasan. Tidak pernah melempar. */
  async function cycle() {
    const t0 = now(); st.stats = { uploaded: 0, skipped: 0, failed: 0 }; st.sentBytes = 0;
    if (!memoryOk(freemem())) { log('RAM bebas menipis: siklus dilewati (agen didahulukan)'); return { skipped: 'ram' }; }
    const iv = intervals({ anyWorking: st.working });
    const docs = {};

    // 1) peristiwa + snapshot: dari memori server Office View (tanpa Paperclip), sering
    if (due('events', iv.events)) {
      mark('events');
      await guarded('events', async () => {
        const snap = await local('/api/snapshot'); await sleep(gapMs);
        st.working = (snap.events ?? []).some((e) => e.type === 'agent.state' && e.state === 'working');
        const ev = await local(`/api/events?since=${st.ring?.epoch === snap.epoch ? st.ring.seq : 0}`);
        st.ring = mergeEvents(st.ring, { ...ev, epoch: snap.epoch });
        docs.snapshot = await publish('doc/snapshot', '/api/snapshot', snap);
        docs.events = await publish('doc/events', '/api/events', st.ring);
      });
    }
    // 2) status ringan: baca berkas/memori, tidak memanggil Paperclip
    if (due('light', iv.light)) {
      mark('light');
      for (const [key, route] of [['doc/network', '/api/network'], ['doc/autopost', '/api/inspect/autopost'], ['doc/autonomy', '/api/inspect/autonomy']]) {
        await guarded(key, async () => { docs[key] = await publish(key, route, await local(route)); await sleep(gapMs); });
      }
    }
    // 3) papan (memanggil Paperclip): jarang
    if (due('board3', iv.board3)) { mark('board3'); await guarded('board3', async () => { st.board3 = await publish('doc/board3', '/api/inspect/board', await local('/api/inspect/board?limit=3')); }); }
    if (due('board', iv.board) || !st.board) {
      mark('board');
      await guarded('board', async () => { st.board = await publish('doc/board', '/api/inspect/board', await local('/api/inspect/board')); docs.board = st.board; });
    }
    // 4) produksi: konten aktif sering, lainnya jarang; hanya maxProd terbaru
    const settings = readJsonSafe(SETTINGS_FILE, {}) ?? {};
    if (st.board?.items) {
      const names = prodDue({ items: st.board.items, lastRead: st.last.prod ?? (st.last.prod = {}), itemHash: st.itemHash, nowMs: now(), iv, maxProd: settings.maxProd ?? 6 });
      for (const prod of names) {
        const it = st.board.items.find((x) => x.prod === prod);
        await guarded(`prod ${prod}`, async () => {
          const view = await local(`/api/inspect/production?prod=${encodeURIComponent(prod)}`);
          docs[`prod/${prod}`] = await publish(`doc/prod/${prod}`, '/api/inspect/production', view); await sleep(gapMs);
          for (const v of (view.versions ?? []).filter((x) => x.rev >= 1).slice(-3)) {
            const rv = await local(`/api/inspect/production?prod=${encodeURIComponent(prod)}&rev=${v.rev}`);
            docs[`prod/${prod}/r${v.rev}`] = await publish(`doc/prod/${prod}/r${v.rev}`, '/api/inspect/production', rv); await sleep(gapMs);
          }
          st.last.prod[prod] = now(); st.itemHash[prod] = hashOf({ s: it.status, sl: it.slides, c: it.cover, t: it.title, r: it.revision });
        });
      }
    }
    // 5) agen + approval (Paperclip): jarang
    if (due('agent', iv.agent)) {
      mark('agent');
      for (const n of AGENTS) await guarded(`agent ${n}`, async () => { docs[`agent/${n}`] = await publish(`doc/agent/${n.toLowerCase()}`, '/api/inspect/agent', await local(`/api/inspect/agent?name=${n}`)); await sleep(gapMs); });
    }
    if (due('approvals', iv.approvals)) { mark('approvals'); await guarded('approvals', async () => { docs.approvals = await publish('doc/approvals', '/api/inspect/approvals', await local('/api/inspect/approvals')); }); }
    // 6) berkas statis: tata letak dan replay (jarang berubah)
    if (due('static', iv.static) || !st.last.static) {
      mark('static');
      await guarded('layout', async () => { await publish('doc/layout', '/api/layout', await local('/api/layout')); });
      await guarded('replay', async () => { await publish('doc/replay', '/api/replay', await local('/api/replay')); });
    }
    // 7) gambar render yang belum tersalin (maks 6 per siklus supaya disk/jaringan tidak melonjak)
    const need = findImagePaths(st.board, st.board3, ...Object.values(docs)).filter((p) => !st.images[p] || st.images[p] !== imageSig(p));
    for (const p of need.slice(0, 6)) {
      await guarded(`gambar ${p}`, async () => {
        const buf = readImage ? readImage(p) : await local(`/api/inspect/image?path=${encodeURIComponent(p)}`, 'buf');
        if (buf.length > 3_800_000) { st.images[p] = imageSig(p); return; } // terlalu besar untuk satu permintaan Vercel: dilewati, ditandai
        await upload(`img/${p}`, buf, 'image/png'); st.images[p] = imageSig(p); st.stats.uploaded += 1; await sleep(gapMs);
      });
    }
    // 8) meta: bukti hidup + usia data (UI memperingatkan bila basi)
    if (due('meta', iv.meta)) {
      mark('meta');
      await guarded('meta', async () => { try { await upload('doc/meta', { publishedAt: now(), cycleMs: now() - t0, working: st.working, pendingImages: Math.max(0, need.length - 6), version: 1 }, 'application/json'); } catch (e) { st.stats.failed += 1; log(`GAGAL meta: ${e.message}`); } });
    }
    if (!dryRun && persist) { mkdirSync(DIR, { recursive: true }); writeJsonAtomic(STATE_FILE, { hashes: st.hashes, images: st.images, at: now() }); }
    const out = { ms: now() - t0, ...st.stats, bytes: st.sentBytes, imagesPending: Math.max(0, need.length - 6), working: st.working };
    return out;
  }
  function imageSig(p) {
    try { const f = path.join(ROOT, 'workspace', 'agent', ...p.split('/')); const s = statSync(f); return `${s.size}:${Math.floor(s.mtimeMs)}`; } catch { return 'x'; }
  }
  return { cycle, state: st };
}

async function main() {
  if (has('--status')) { const s = readJsonSafe(STATE_FILE, null); const e = readEnv(); console.log(JSON.stringify({ konfigurasi: { MIRROR_URL: e.MIRROR_URL ?? null, ingestSecret: e.MIRROR_INGEST_SECRET ? 'ada' : 'belum', lokal: LOCAL }, terakhir: s?.at ? new Date(s.at).toISOString() : null, dokumen: Object.keys(s?.hashes ?? {}).length, gambar: Object.keys(s?.images ?? {}).length }, null, 2)); return; }
  const settings = readJsonSafe(SETTINGS_FILE, null);
  if (!settings) { mkdirSync(DIR, { recursive: true }); writeJsonAtomic(SETTINGS_FILE, { enabled: true, maxProd: 6 }); }
  const pub = createPublisher({ dryRun: has('--dry-run') });
  if (has('--once') || has('--dry-run')) { console.log(JSON.stringify(await pub.cycle(), null, 2)); return; }
  try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* prioritas rendah bila didukung */ }
  log(`publisher monitor kedua dimulai (lokal ${LOCAL}); membaca saja, berurutan, melambat saat sepi`);
  for (;;) {
    const s = readJsonSafe(SETTINGS_FILE, {}) ?? {};
    if (s.enabled === false || existsSync(path.join(DIR, 'PAUSE'))) { await sleep(15_000); continue; }
    const r = await pub.cycle();
    if (r.uploaded || r.failed) log(`siklus: ${r.uploaded} diunggah, ${r.skipped} tak berubah, ${r.failed} gagal, ${Math.round((r.bytes ?? 0) / 1024)} KB, ${r.ms} ms${r.working ? ' (agen bekerja)' : ''}`);
    await sleep(5_000);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
void ACTIVE_STATUS;
