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
 * Jadwal penyegaran (ms). KUOTA Vercel Blob kecil (operasi tulis = "advanced", ribuan per bulan): publisher hanya bekerja saat monitor DIBUKA (demand),
 * dokumen panas digabung jadi SATU unggahan, jadwal renggang. slow=true (kuota bulanan >=80%) melipatempatkan semua jeda.
 * hot = snapshot+events+network+autopost+autonomy+meta dalam satu dokumen; heartbeat = jeda maksimum unggahan "hidup" bila isi tak berubah.
 */
export function intervals({ anyWorking, slow = false }) {
  const m = slow ? 4 : 1;
  const base = anyWorking
    ? { hot: 30_000, board: 300_000, approvals: 300_000, agent: 600_000, prodActive: 180_000, prodIdle: 60 * 60_000, static: 6 * 3_600_000, heartbeat: 240_000 }
    : { hot: 90_000, board: 600_000, approvals: 600_000, agent: 1_800_000, prodActive: 600_000, prodIdle: 2 * 3_600_000, static: 6 * 3_600_000, heartbeat: 480_000 };
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v * m]));
}

/** Penghitung tulis Blob per bulan (kalender UTC). Murni: mengembalikan state baru. */
export function bumpUsage(usage, nowMs, n = 1) {
  const month = new Date(nowMs).toISOString().slice(0, 7);
  const u = usage?.month === month ? usage : { month, puts: 0 };
  return { month, puts: u.puts + n };
}
/** ok=false bila kuota habis; slow=true bila >=80% terpakai. */
export function budgetState(usage, nowMs, max = 1500) {
  const month = new Date(nowMs).toISOString().slice(0, 7);
  const puts = usage?.month === month ? usage.puts : 0;
  return { puts, max, ok: puts < max, slow: puts >= max * 0.8 };
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
