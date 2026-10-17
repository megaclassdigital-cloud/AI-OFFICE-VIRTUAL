// scrub.mjs — penyaring teks untuk data yang keluar dari laptop (mode review dan monitor kedua). Murni.
// Membuang: jalur berkas lokal, id internal (UUID dipetakan stabil ke id pendek), rahasia/token, alamat surel. Kode konten (EDU-97) dan teks berita tetap.
const WIN_PATH = /\b[A-Za-z]:[\\/](?:[^\s"'<>|*?\\/:]+[\\/])*[^\s"'<>|*?\\/:]*/g;
const USER_PATH = /(?:\/Users\/|\/home\/)[^\s"'<>]+/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const SECRETS = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{16,}\b/g,
  /\bvercel_blob_rw_[A-Za-z0-9_]+\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\b(?:api[_-]?key|secret|token|password|passwd|pin)\s*[:=]\s*["']?[^\s"',;]{6,}/gi,
  /\bAAO_[A-Z_]+=\S+/g,
];
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** UUID -> "id-xxxxxxxx" (8 hex pertama): stabil, sehingga agentId di snapshot dan events tetap saling cocok. */
export const shortId = (u) => 'id-' + String(u).slice(0, 8).toLowerCase();

export function scrubString(s) {
  let t = String(s);
  t = t.replace(UUID, shortId);
  for (const re of SECRETS) t = t.replace(re, '[disembunyikan]');
  t = t.replace(WIN_PATH, (m) => (/^[A-Za-z]:[\\/]*$/.test(m) ? m : '[jalur-lokal]'));
  t = t.replace(USER_PATH, '[jalur-lokal]');
  t = t.replace(EMAIL, '[surel]');
  return t;
}

/** Jalur RELATIF konten (runs/EDU-97/render/slide-01.png) sengaja tidak disentuh: bukan jalur lokal dan dipakai UI untuk memuat gambar. */
export function scrubDeep(v, depth = 0) {
  if (depth > 40) return null;
  if (typeof v === 'string') return scrubString(v);
  if (Array.isArray(v)) return v.map((x) => scrubDeep(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x, depth + 1)]));
  return v;
}
