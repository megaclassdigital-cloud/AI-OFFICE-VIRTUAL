// plan.mjs — logika murni publisher monitor kedua: jadwal penyegaran per dokumen, pemilihan gambar, ring peristiwa, hash. Tanpa I/O.
import crypto from 'node:crypto';

export const hashOf = (v) => crypto.createHash('sha1').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(v)).digest('hex');

const IMG_RE = /runs\/[A-Za-z0-9_-]+(?:\/revision-[0-9]+)?\/render\/[A-Za-z0-9._-]+\.png/g;
/** Semua jalur gambar render (relatif) yang disebut di dokumen mana pun. */
export function findImagePaths(...docs) {
  const out = new Set();
  const walk = (v, d = 0) => {
    if (d > 30) return;
    if (typeof v === 'string') { for (const m of v.matchAll(IMG_RE)) out.add(m[0]); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, d + 1));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, d + 1));
  };
  docs.forEach((d) => walk(d));
  return [...out];
}

/** Ring peristiwa lokal: gabungkan peristiwa baru (seq naik); epoch berganti => mulai ulang. */
export function mergeEvents(ring, incoming, max = 300) {
  if (!incoming) return ring;
  if (!ring || ring.epoch !== incoming.epoch) return { epoch: incoming.epoch, seq: incoming.seq, connected: incoming.connected, events: (incoming.events ?? []).slice(-max) };
  const have = new Set(ring.events.map((e) => e.seq));
  const events = [...ring.events, ...(incoming.events ?? []).filter((e) => !have.has(e.seq))].sort((a, b) => a.seq - b.seq).slice(-max);
  return { epoch: ring.epoch, seq: Math.max(ring.seq, incoming.seq), connected: incoming.connected, events };
}

export const ACTIVE_STATUS = new Set(['berjalan', 'menunggu_aset', 'terblokir', 'perlu_revisi']);

/**
 * Jadwal penyegaran (ms). Hemat beban Paperclip: dokumen yang butuh pembacaan Paperclip (production, agent, approvals, board) dibaca jarang;
 * peristiwa/snapshot (dari memori server, tanpa Paperclip) sering. Saat tidak ada agen bekerja, semuanya melambat.
 */
export function intervals({ anyWorking }) {
  return anyWorking
    ? { events: 8_000, light: 30_000, board3: 40_000, board: 120_000, approvals: 90_000, agent: 90_000, prodActive: 60_000, prodIdle: 20 * 60_000, static: 30 * 60_000, meta: 15_000 }
    : { events: 20_000, light: 60_000, board3: 120_000, board: 300_000, approvals: 300_000, agent: 600_000, prodActive: 120_000, prodIdle: 30 * 60_000, static: 60 * 60_000, meta: 30_000 };
}

/** Dokumen produksi yang perlu disegarkan sekarang: konten aktif sering, lainnya bila item di board berubah atau sudah lama. */
export function prodDue({ items, lastRead, itemHash, nowMs, iv, maxProd = 6 }) {
  return [...items].sort((a, b) => Date.parse(b.createdAt ?? 0) - Date.parse(a.createdAt ?? 0)).slice(0, maxProd).filter((it) => {
    const last = lastRead[it.prod] ?? 0; const active = ACTIVE_STATUS.has(it.status?.key);
    if (!last) return true;
    if (itemHash[it.prod] !== hashOf({ s: it.status, sl: it.slides, c: it.cover, t: it.title, r: it.revision })) return true;
    return nowMs - last >= (active ? iv.prodActive : iv.prodIdle);
  }).map((it) => it.prod);
}

/** Apakah memori bebas cukup untuk bekerja tanpa mengganggu agen (publisher berhenti sejenak bila tidak). */
export const memoryOk = (freeBytes, minBytes = 500 * 1024 * 1024) => freeBytes >= minBytes;
