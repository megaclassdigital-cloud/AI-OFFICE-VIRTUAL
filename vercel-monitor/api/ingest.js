// /api/ingest — satu-satunya jalur tulis. Hanya laptop yang memegang MIRROR_INGEST_SECRET. Satu dokumen/gambar per permintaan (maks 4 MB).
import { getStore, validKey, safeEq, send, readBody, viewerActive, clearMemo } from './_lib.js';

const TYPES = { json: 'application/json; charset=utf-8', png: 'image/png' };

export default async function handler(req, res) {
  const secret = process.env.MIRROR_INGEST_SECRET;
  // GET ?demand=1: laptop menanyakan apakah ada pengunjung (tanpa menyentuh Blob). Publisher tidur bila tidak ada => hemat kuota tulis.
  if (req.method === 'GET') {
    if (!secret) return send(res, 503, { error: 'MIRROR_INGEST_SECRET belum diatur' });
    if (!safeEq(req.headers['x-ingest-secret'] ?? '', secret)) return send(res, 401, { error: 'ditolak' });
    return send(res, 200, { viewing: viewerActive() });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'hanya POST/GET' });
  if (!secret) return send(res, 503, { error: 'MIRROR_INGEST_SECRET belum diatur' });
  if (!safeEq(req.headers['x-ingest-secret'] ?? '', secret)) return send(res, 401, { error: 'ditolak' });
  const url = new URL(req.url, 'http://x');
  const key = url.searchParams.get('key') ?? '';
  if (!validKey(key)) return send(res, 400, { error: 'kunci tidak valid' });
  const kind = key.startsWith('img/') ? 'png' : 'json';
  let body;
  try { body = await readBody(req); } catch (e) { return send(res, e.code === 413 ? 413 : 400, { error: 'badan tidak valid atau terlalu besar' }); }
  if (kind === 'json') { try { JSON.parse(body.toString('utf8')); } catch { return send(res, 400, { error: 'JSON tidak valid' }); } }
  else if (!(body.length > 8 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47)) return send(res, 400, { error: 'bukan PNG' });
  try { await getStore().put(key, body, TYPES[kind]); } catch (e) { return send(res, 502, { error: 'penyimpanan gagal: ' + String(e.message).slice(0, 120) }); }
  clearMemo(); // instance ini menyajikan data baru segera
  return send(res, 200, { ok: true, key, bytes: body.length });
}
