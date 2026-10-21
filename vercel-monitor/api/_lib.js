// _lib.js — pustaka bersama fungsi Vercel monitor kedua. Tanpa LLM, hanya-baca untuk pengunjung; satu-satunya jalur tulis adalah /api/ingest (rahasia dari laptop).
// Penyimpanan: Vercel Blob PRIVAT (produksi) atau folder lokal (MIRROR_FS_DIR; dipakai tes dan latihan lokal).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const COOKIE = 'aao_monitor';
export const TTL_MS = 7 * 24 * 3_600_000;
const b64 = (buf) => Buffer.from(buf).toString('base64url');

export const sign = (body, secret) => b64(crypto.createHmac('sha256', secret).update(body).digest());
export const makeSession = (secret, nowMs = Date.now()) => { const body = `monitor.${nowMs + TTL_MS}`; return `${body}.${sign(body, secret)}`; };
export function parseSession(cookieHeader, secret, nowMs = Date.now()) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(String(cookieHeader ?? ''));
  if (!m || !secret) return false;
  const [role, exp, sig] = decodeURIComponent(m[1]).split('.');
  if (role !== 'monitor' || !/^[0-9]+$/.test(exp ?? '') || !sig) return false;
  const a = Buffer.from(sig); const b = Buffer.from(sign(`${role}.${exp}`, secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b) && Number(exp) > nowMs;
}
export const safeEq = (x, y) => { const a = Buffer.from(String(x)); const b = Buffer.from(String(y)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
export const cookieHeader = (secret, secure, nowMs) => `${COOKIE}=${encodeURIComponent(makeSession(secret, nowMs))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(TTL_MS / 1000)}${secure ? '; Secure' : ''}`;

export const KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,200}$/;
export const validKey = (k) => typeof k === 'string' && KEY_RE.test(k) && !k.includes('..') && !k.includes('//') && !k.endsWith('/');

// ───────── penyimpanan ─────────
function fsStore(dir) {
  const file = (key) => path.join(dir, encodeURIComponent('mirror/' + key)); // datar: kunci 'a' dan 'a/b' boleh berdampingan (seperti Blob)
  return {
    async put(key, body, contentType) { const f = file(key); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, body); await fs.writeFile(f + '.type', contentType ?? 'application/octet-stream'); },
    async get(key) {
      try { const f = file(key); const buf = await fs.readFile(f); const type = await fs.readFile(f + '.type', 'utf8').catch(() => 'application/octet-stream'); return { buf, contentType: type }; } catch { return null; }
    },
  };
}
function blobStore() {
  let mod;
  const sdk = async () => (mod ??= await import('@vercel/blob'));
  return {
    async put(key, body, contentType) { const { put } = await sdk(); await put('mirror/' + key, body, { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType, cacheControlMaxAge: 60 }); },
    async get(key) {
      const { get } = await sdk(); const r = await get('mirror/' + key, { access: 'private', useCache: false });
      if (!r || r.statusCode !== 200 || !r.stream) return null;
      const buf = Buffer.from(await new Response(r.stream).arrayBuffer());
      return { buf, contentType: r.blob?.contentType ?? 'application/octet-stream' };
    },
  };
}
export const getStore = () => (process.env.MIRROR_FS_DIR ? fsStore(process.env.MIRROR_FS_DIR) : blobStore());

export const getJson = async (store, key) => { const r = await store.get(key); if (!r) return null; try { return JSON.parse(r.buf.toString('utf8')); } catch { return null; } };

// ───────── hemat kuota Blob ─────────
// Pembacaan Blob (get) dihitung kuota. Banyak tab/polling meminta dokumen yang sama: simpan di memori instance fungsi (TTL pendek) dan gabungkan permintaan yang sedang berjalan.
const memo = globalThis.__aaoMemo ??= new Map();
export async function cachedJson(store, key, ttlMs, nowMs = Date.now()) {
  const hit = memo.get(key);
  if (hit && nowMs - hit.at < ttlMs) return hit.p;
  const p = getJson(store, key).catch((e) => { memo.delete(key); throw e; });
  memo.set(key, { at: nowMs, p });
  if (memo.size > 200) for (const k of memo.keys()) { memo.delete(k); if (memo.size <= 150) break; }
  return p;
}
export const clearMemo = () => memo.clear();
// Sinyal "ada yang membuka monitor": diisi setiap permintaan data pengunjung, dibaca laptop lewat /api/ingest?demand=1 (publisher tidur bila tak ada pengunjung).
export const VIEW_WINDOW_MS = 180_000;
export const markViewer = (nowMs = Date.now()) => { globalThis.__aaoViewerAt = nowMs; };
export const viewerActive = (nowMs = Date.now()) => nowMs - (globalThis.__aaoViewerAt ?? 0) < VIEW_WINDOW_MS;

// ───────── HTTP kecil ─────────
export const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => {
  res.statusCode = code;
  res.setHeader('content-type', type); res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
export const isHttps = (req) => String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
export const readBody = (req, max = 4_000_000) => new Promise((resolve, reject) => {
  // Kelebihan ukuran: tetap dibaca habis (dibuang) supaya klien menerima jawaban 413, bukan koneksi terputus.
  const chunks = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n <= max) chunks.push(c); });
  req.on('end', () => (n > max ? reject(Object.assign(new Error('terlalu besar'), { code: 413 })) : resolve(Buffer.concat(chunks)))); req.on('error', reject);
});
