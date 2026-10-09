// asset-gate.mjs — gerbang aset gambar untuk tahap Designer (KODE, bukan LLM).
// Designer menulis carousel-design.json + asset-requests.json; kode mencocokkan keduanya, mengambil gambar (capture-asset.mjs),
// dan menahan produksi bila ada aset yang belum asli/belum ada. Tidak ada gambar pengganti.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const ASSET_PREFIX = (identifier) => `runs/${identifier}/assets/`;
export const HOLD_RETRY_MS = 10 * 60_000;
const OK_STATUS = new Set(['captured', 'owner-supplied', 'kept']);

/** Slot gambar yang dipakai desain: [{ slide, slot, file }] untuk path runs/<ID>/assets/<berkas>; path brand/ (aset tetap brand kit) diabaikan. */
export function imageSlotsUsed(design, templates, identifier) {
  const used = [];
  for (const s of design?.slides ?? []) {
    const def = templates?.[s.template]?.slots ?? {};
    for (const [slot, value] of Object.entries(s.slots ?? {})) {
      if (def[slot]?.type !== 'image') continue;
      const v = String(value);
      if (v.startsWith(ASSET_PREFIX(identifier))) used.push({ slide: s.index, slot, file: v.slice(ASSET_PREFIX(identifier).length) });
    }
  }
  return used;
}

/** Pencocokan desain <-> permintaan aset. Mengembalikan daftar galat untuk Designer (kosong = cocok). */
export function matchRequests(used, requestsDoc) {
  const errors = [];
  if (!used.length) return errors;
  const reqs = requestsDoc?.requests ?? [];
  const byFile = new Map(reqs.map((r) => [r.file, r]));
  for (const u of used) {
    const r = byFile.get(u.file);
    if (!r) errors.push(`slide ${u.slide}: gambar "${u.file}" belum ada di asset-requests.json (tulis permintaannya: slide, file, kind, query)`);
    else if (r.slide !== u.slide) errors.push(`asset-requests.json: "${u.file}" bertanda slide ${r.slide}, tetapi dipakai di slide ${u.slide}`);
  }
  return errors;
}

/** Status manifest -> { complete, missing:[{file,status,reason}] }. Hanya captured / owner-supplied / kept yang dianggap ada. */
export function manifestVerdict(manifest, usedFiles) {
  const byFile = new Map((manifest?.assets ?? []).map((a) => [a.file, a]));
  const missing = [];
  for (const f of usedFiles) {
    const a = byFile.get(f);
    if (!a || !OK_STATUS.has(a.status)) missing.push({ file: f, status: a?.status ?? 'missing', reason: a?.reason ?? 'belum diambil' });
  }
  return { complete: missing.length === 0, missing };
}

/** Pesan untuk owner saat produksi ditahan. */
export function holdMessage(identifier, missing) {
  const list = missing.map((m) => `- ${m.file} (${m.status}${m.reason ? `: ${String(m.reason).slice(0, 140)}` : ''})`).join('\n');
  return `Produksi ${identifier} DITAHAN: ${missing.length} gambar asli belum bisa diambil.\n${list}\n` +
    `Cara melanjutkan: taruh gambar asli (screenshot logo/produk) di workspace/inbox/assets/${identifier}/<nama-berkas>, ` +
    `atau bila Google meminta verifikasi, jalankan "node scripts/browser-login.mjs" lalu selesaikan verifikasinya sendiri. Pipeline mencoba lagi otomatis.`;
}

/** Tanda tangan isi folder inbox owner (nama + ukuran + waktu ubah), untuk tahu kapan perlu mencoba ulang lebih cepat. */
export function inboxSignature(rootDir, identifier) {
  const dir = path.join(rootDir, 'workspace', 'inbox', 'assets', identifier);
  if (!existsSync(dir)) return '';
  return readdirSync(dir).sort().map((n) => { const st = statSync(path.join(dir, n)); return `${n}:${st.size}:${Math.round(st.mtimeMs)}`; }).join('|');
}

/** Perlu mencoba ambil lagi? Ya bila belum pernah, inbox berubah, atau sudah lewat HOLD_RETRY_MS sejak percobaan terakhir. */
export function shouldRetryCapture(holdState, sig, nowMs) {
  if (!holdState) return true;
  if (holdState.sig !== sig) return true;
  return nowMs - holdState.at >= HOLD_RETRY_MS;
}

export const readHold = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
export const writeHold = (file, state) => writeFileSync(file, JSON.stringify(state) + '\n');
