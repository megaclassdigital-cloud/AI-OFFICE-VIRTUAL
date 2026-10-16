#!/usr/bin/env node
// scheduler.mjs — penjadwal posting berbasis KESEGARAN (ADR-0005). Murni KODE: tanpa LLM, tanpa kuota, tanpa efek ke luar.
// Prinsip: konten harus HANGAT. Tiap konten punya freshUntil (sumber terbaru + freshHours). Penjadwal memberi slot dengan aturan
// "deadline terdekat dulu" di dalam jendela jam milik owner; konten yang tidak kebagian slot sebelum freshUntil menjadi `kedaluwarsa`
// (owner yang memutuskan; tidak pernah diposting otomatis). Manager membuat brief baru hanya bila ada slot kosong (briefsNeeded).
//
// Berkas (workspace/agent/jadwal/): settings.json (milik owner, bawaan dibuat otomatis) dan antrean.json (diisi kode).
// Pemakaian: node scripts/scheduler.mjs --status | --add EDU-97 | --plan
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomic, readJsonSafe } from './safe-json.mjs';
import { CONTENT_RE, latestRunKey, runDirOf, masterIdentifierOf } from './run-registry.mjs';

const MIN = 60_000; const HOUR = 60 * MIN; const DAY = 24 * HOUR;
/** Status yang tidak boleh dijadwalkan ulang oleh penjadwal (sudah/sedang ditangani autoposter atau owner). */
const FINAL = ['diposting', 'dibatalkan', 'gagal', 'tidak_pasti', 'sedang_diposting'];

export const DEFAULT_SETTINGS = Object.freeze({
  utcOffsetMinutes: 420,        // WIB (UTC+7, tanpa DST)
  freshHours: 48,               // umur maksimal berita sejak sumber TERBARU
  minGapMinutes: 180,           // jeda minimum antar posting pada satu platform
  leadMinutes: 20,              // slot harus minimal sekian menit di depan (waktu siap runner)
  horizonHours: 24,             // horizon penarikan: brief dibuat hanya untuk slot dalam jangka ini
  paused: false,                // jeda penjadwalan global
  platforms: {
    instagram: { enabled: true, windows: ['07:00-09:00', '12:00-13:30', '19:00-21:30'], maxPerDay: 2 },
    tiktok: { enabled: true, windows: ['07:00-09:00', '12:00-13:30', '19:00-21:30'], maxPerDay: 2 },
  },
});

/** Gabungkan pengaturan owner dengan bawaan (per platform). */
export function mergeSettings(user = {}) {
  const platforms = {};
  for (const [name, def] of Object.entries(DEFAULT_SETTINGS.platforms)) platforms[name] = { ...def, ...(user.platforms?.[name] ?? {}) };
  for (const [name, p] of Object.entries(user.platforms ?? {})) if (!platforms[name]) platforms[name] = { enabled: true, windows: ['12:00-13:00'], maxPerDay: 1, ...p };
  return { ...DEFAULT_SETTINGS, ...user, platforms };
}

/** "07:00-09:00" -> { startMin, endMin } (menit sejak tengah malam lokal) atau null. */
export function parseWindow(w) {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(String(w).trim());
  if (!m) return null;
  const startMin = Number(m[1]) * 60 + Number(m[2]); const endMin = Number(m[3]) * 60 + Number(m[4]);
  return startMin < endMin && endMin <= 24 * 60 ? { startMin, endMin } : null;
}

/** Jitter menit yang DETERMINISTIK (hash FNV-1a): jam tidak persis sama tiap hari, tetapi hasil yang sama untuk masukan yang sama. */
export function jitterMinutes(seed, maxMinutes) {
  let h = 0x811c9dc5;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return maxMinutes > 0 ? h % (maxMinutes + 1) : 0;
}

const dayIndexOf = (ms, off) => Math.floor((ms + off * MIN) / DAY);
const dayStartUtc = (dayIndex, off) => dayIndex * DAY - off * MIN;

/** Semua slot kandidat satu platform di [fromMs, toMs]: satu slot per jendela per hari, diurutkan. */
export function candidateSlots(settings, platform, fromMs, toMs) {
  const p = settings.platforms?.[platform];
  if (!p || p.enabled === false) return [];
  const off = settings.utcOffsetMinutes; const out = [];
  const wins = (p.windows ?? []).map(parseWindow).filter(Boolean);
  for (let d = dayIndexOf(fromMs, off) - 1; d <= dayIndexOf(toMs, off) + 1; d++) {
    wins.forEach((w, wi) => {
      const span = w.endMin - w.startMin;
      const jit = jitterMinutes(`${platform}|${d}|${wi}`, Math.min(30, Math.max(0, span - 1)));
      const t = dayStartUtc(d, off) + (w.startMin + jit) * MIN;
      if (t >= fromMs && t <= toMs) out.push(t);
    });
  }
  return out.sort((a, b) => a - b);
}

/** freshUntil (ms) dari waktu sumber terbaru. */
export const freshUntilMs = (newestSourceMs, freshHours) => newestSourceMs + freshHours * HOUR;

/** Memenuhi jeda minimum dan batas per hari terhadap slot yang sudah ada pada platform yang sama? */
function fits(t, taken, settings, platform) {
  const p = settings.platforms[platform]; const off = settings.utcOffsetMinutes;
  if (taken.some((x) => Math.abs(x - t) < settings.minGapMinutes * MIN)) return false;
  const day = dayIndexOf(t, off);
  return taken.filter((x) => dayIndexOf(x, off) === day).length < (p.maxPerDay ?? 1);
}

/**
 * Beri slot untuk satu platform. items: [{ content, freshUntil, slotAt?, status? }] (hanya yang belum diposting).
 * Aturan: (1) slot lama yang masih sah dipertahankan (stabil, tidak dikocok ulang); (2) sisanya deadline terdekat dulu, slot paling awal yang sah;
 * (3) tanpa slot sebelum freshUntil => `kedaluwarsa`. Mengembalikan salinan item dengan { slotAt, status }.
 */
export function assignSlots(items, settings, platform, nowMs) {
  const horizonEnd = nowMs + 14 * DAY; const lead = settings.leadMinutes * MIN;
  const res = new Map(); const taken = [];
  const live = items.filter((i) => !FINAL.includes(i.status));
  // (1) pertahankan yang sah
  for (const it of live) {
    if (it.slotAt && it.slotAt >= nowMs - lead && it.slotAt <= it.freshUntil && fits(it.slotAt, taken, settings, platform)) { taken.push(it.slotAt); res.set(it.content, { ...it, status: 'terjadwal' }); }
  }
  // (2) sisanya, deadline terdekat dulu
  const rest = live.filter((i) => !res.has(i.content)).sort((a, b) => a.freshUntil - b.freshUntil || String(a.content).localeCompare(String(b.content)));
  for (const it of rest) {
    if (it.freshUntil <= nowMs) { res.set(it.content, { ...it, slotAt: null, status: 'kedaluwarsa' }); continue; }
    const to = Math.min(it.freshUntil, horizonEnd);
    const slot = candidateSlots(settings, platform, nowMs + lead, to).find((t) => fits(t, taken, settings, platform));
    if (slot != null) { taken.push(slot); res.set(it.content, { ...it, slotAt: slot, status: 'terjadwal' }); }
    else res.set(it.content, { ...it, slotAt: null, status: 'kedaluwarsa' });
  }
  return live.map((i) => res.get(i.content));
}

/**
 * Sinyal PENARIKAN untuk Manager: berapa brief baru yang boleh dibuat sekarang. = slot kosong dalam horizon (min lintas platform aktif)
 * dikurangi konten yang sudah dalam produksi. Nol bila dijeda. Konten dalam produksi dianggap akan memakai satu slot tiap platform.
 */
export function briefsNeeded({ settings, queue, inProduction = 0, nowMs }) {
  if (settings.paused) return 0;
  const horizon = nowMs + settings.horizonHours * HOUR; const lead = settings.leadMinutes * MIN;
  const counts = [];
  for (const [name, p] of Object.entries(settings.platforms)) {
    if (p.enabled === false) continue;
    const taken = (queue ?? []).filter((i) => i.platforms?.[name]?.slotAt && ![...FINAL, 'kedaluwarsa'].includes(i.platforms[name].status)).map((i) => i.platforms[name].slotAt);
    let free = 0;
    for (const t of candidateSlots(settings, name, nowMs + lead, horizon)) if (fits(t, taken, settings, name)) { taken.push(t); free++; }
    counts.push(free);
  }
  return counts.length ? Math.max(0, Math.min(...counts) - inProduction) : 0;
}

// ───────── penyimpanan ─────────
export const jadwalDir = (outputs) => path.join(outputs, 'jadwal');
export function loadSettings(outputs) { return mergeSettings(readJsonSafe(path.join(jadwalDir(outputs), 'settings.json'), {}) ?? {}); }
export function ensureSettingsFile(outputs) {
  const f = path.join(jadwalDir(outputs), 'settings.json');
  if (!existsSync(f)) { mkdirSync(jadwalDir(outputs), { recursive: true }); writeJsonAtomic(f, DEFAULT_SETTINGS); }
  return f;
}
export const loadQueue = (outputs) => readJsonSafe(path.join(jadwalDir(outputs), 'antrean.json'), []) ?? [];
export function saveQueue(outputs, queue) { mkdirSync(jadwalDir(outputs), { recursive: true }); writeJsonAtomic(path.join(jadwalDir(outputs), 'antrean.json'), queue); }

/** Waktu sumber TERBARU (ms) yang dipakai sebuah konten: kandidat terverifikasi pada versi terbaru, jatuh ke semua kandidat bila perlu. */
export function newestSourceMs(outputs, contentId) {
  const dir = runDirOf(outputs, latestRunKey(outputs, contentId));
  const rd = (f) => readJsonSafe(path.join(dir, f), null);
  const research = rd('research-output.json'); const ver = rd('verification-result.json');
  const ok = new Set((ver?.results ?? []).filter((r) => r.status === 'verified').map((r) => r.candidateId));
  const dates = (research?.candidates ?? []).filter((c) => !ok.size || ok.has(c.id)).map((c) => Date.parse(c.published_at)).filter(Number.isFinite);
  return dates.length ? Math.max(...dates) : null;
}

/** Masukkan konten yang sudah di-approve ke antrean (idempoten per konten). */
export function enqueueContent(outputs, contentId, nowMs, settings = loadSettings(outputs)) {
  if (!CONTENT_RE.test(contentId)) throw new Error(`kode konten tidak valid: ${contentId}`);
  const queue = loadQueue(outputs);
  if (queue.some((i) => i.content === contentId)) return { queue, added: false };
  const src = newestSourceMs(outputs, contentId);
  if (src == null) throw new Error(`${contentId}: tanggal sumber tidak terbaca (research-output.json)`);
  const fresh = freshUntilMs(src + DAY - 1, settings.freshHours); // tanggal terbit tanpa jam = akhir hari itu
  const platforms = Object.fromEntries(Object.entries(settings.platforms).filter(([, p]) => p.enabled !== false).map(([n]) => [n, { status: 'menunggu', slotAt: null }]));
  queue.push({ content: contentId, master: masterIdentifierOf(outputs, latestRunKey(outputs, contentId)), approvedAt: new Date(nowMs).toISOString(), newestSourceAt: new Date(src).toISOString(), freshUntil: fresh, platforms });
  return { queue, added: true };
}

/** Hitung ulang slot semua platform untuk seluruh antrean (stabil). Mengembalikan antrean baru. */
export function replan(queue, settings, nowMs) {
  const out = queue.map((i) => ({ ...i, platforms: { ...i.platforms } }));
  for (const name of Object.keys(settings.platforms)) {
    if (settings.platforms[name].enabled === false) continue;
    const items = out.filter((i) => i.platforms[name]).map((i) => ({ content: i.content, freshUntil: i.freshUntil, slotAt: i.platforms[name].slotAt ?? null, status: i.platforms[name].status === 'menunggu' ? undefined : i.platforms[name].status }));
    for (const r of assignSlots(items, settings, name, nowMs)) {
      const target = out.find((i) => i.content === r.content);
      target.platforms[name] = { ...target.platforms[name], status: r.status, slotAt: r.slotAt };
    }
  }
  return out;
}

const fmt = (ms, off) => (ms ? new Date(ms + off * MIN).toISOString().slice(0, 16).replace('T', ' ') + ' WIB' : '-');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const outputs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'workspace', 'agent');
  const now = Date.now();
  ensureSettingsFile(outputs);
  const settings = loadSettings(outputs);
  let queue = loadQueue(outputs);
  if (a.includes('--add')) {
    const r = enqueueContent(outputs, a[a.indexOf('--add') + 1], now, settings);
    queue = r.queue; console.log(r.added ? 'ditambahkan ke antrean' : 'sudah ada di antrean');
  }
  if (a.includes('--plan') || a.includes('--add')) { queue = replan(queue, settings, now); saveQueue(outputs, queue); }
  const off = settings.utcOffsetMinutes;
  console.log(`Penjadwal ${settings.paused ? '(DIJEDA)' : 'aktif'} | segar ${settings.freshHours} jam | jeda ${settings.minGapMinutes} mnt | horizon ${settings.horizonHours} jam`);
  for (const [n, p] of Object.entries(settings.platforms)) console.log(`  ${n}: ${p.enabled === false ? 'nonaktif' : `jendela ${p.windows.join(', ')}; maks ${p.maxPerDay}/hari`}`);
  console.log(`Antrean (${queue.length}):`);
  for (const i of queue) console.log(`  ${i.content}  segar sampai ${fmt(i.freshUntil, off)}  ${Object.entries(i.platforms).map(([n, s]) => `${n}=${s.status}${s.slotAt ? ' @' + fmt(s.slotAt, off) : ''}`).join('  ')}`);
  console.log(`Brief baru yang boleh dibuat sekarang: ${briefsNeeded({ settings, queue, inProduction: 0, nowMs: now })}`);
}
