// Routing Middleware (Edge): SEMUA halaman (termasuk berkas statis) butuh cookie sesi monitor yang valid, kecuali /review dan /api/review.
// Gagal-tertutup: tanpa MIRROR_SESSION_SECRET semuanya ditolak. HMAC-SHA256 base64url, sama dengan api/_lib.js.
export const config = { matcher: '/((?!_vercel).*)' };

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

async function valid(cookieHeader, secret) {
  const m = /(?:^|;\s*)aao_monitor=([^;]+)/.exec(cookieHeader || '');
  if (!m || !secret) return false;
  const [role, exp, sig] = decodeURIComponent(m[1]).split('.');
  if (role !== 'monitor' || !/^[0-9]+$/.test(exp || '') || !sig || Number(exp) <= Date.now()) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = b64url(await crypto.subtle.sign('HMAC', key, enc.encode(`${role}.${exp}`)));
  if (want.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}

export default async function middleware(request) {
  const { pathname } = new URL(request.url);
  if (pathname === '/review' || pathname === '/api/review' || pathname === '/api/ingest') return; // ingest punya rahasia sendiri; review memeriksa kunci
  if (await valid(request.headers.get('cookie'), process.env.MIRROR_SESSION_SECRET)) return;
  return new Response('Akses ditolak. Buka tautan monitor yang diberikan.', { status: 401, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' } });
}
