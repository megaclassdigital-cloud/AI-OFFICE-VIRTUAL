// /review?key=... — tautan masuk monitor kedua: kunci benar => cookie sesi (HttpOnly, SameSite=Strict) lalu ke halaman utama.
import { cookieHeader, safeEq, send, isHttps } from './_lib.js';

const hits = new Map(); // pembatas laju sederhana per alamat (cukup untuk satu instans; Vercel bisa memakai beberapa, ini lapis tambahan)
function allowed(ip) {
  const t = Date.now(); const arr = (hits.get(ip) ?? []).filter((x) => t - x < 60_000); arr.push(t); hits.set(ip, arr);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some((x) => t - x < 60_000)) hits.delete(k);
  return arr.length <= 10;
}

export default function handler(req, res) {
  const want = process.env.MIRROR_REVIEW_KEY; const secret = process.env.MIRROR_SESSION_SECRET;
  if (!want || !secret) return send(res, 503, 'Monitor belum dikonfigurasi.', 'text/plain; charset=utf-8');
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '?').split(',')[0].trim();
  if (!allowed(ip)) return send(res, 429, 'Terlalu banyak percobaan.', 'text/plain; charset=utf-8', { 'retry-after': '60' });
  const key = new URL(req.url, 'http://x').searchParams.get('key') ?? '';
  if (!safeEq(key, want)) return send(res, 403, 'Tautan tidak valid.', 'text/plain; charset=utf-8');
  res.statusCode = 302; res.setHeader('location', '/'); res.setHeader('set-cookie', cookieHeader(secret, isHttps(req))); res.setHeader('cache-control', 'no-store'); res.end();
}
