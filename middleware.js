// Vercel Edge Middleware: kata sandi untuk situs review. Gagal-tertutup: tanpa REVIEW_PASSWORD di env Vercel, situs menolak semua permintaan.
// Atur di Vercel: Project Settings > Environment Variables > REVIEW_PASSWORD (dan opsional REVIEW_USER, default "klien").
export const config = { matcher: '/((?!_vercel).*)' };

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default function middleware(request) {
  const pass = process.env.REVIEW_PASSWORD;
  if (!pass) return new Response('Situs belum dikonfigurasi (REVIEW_PASSWORD belum diatur).', { status: 503, headers: { 'cache-control': 'no-store' } });
  const user = process.env.REVIEW_USER || 'klien';
  const h = request.headers.get('authorization') || '';
  if (h.startsWith('Basic ')) {
    try {
      const [u, ...rest] = atob(h.slice(6)).split(':');
      if (safeEqual(u, user) & safeEqual(rest.join(':'), pass)) return; // lanjut ke berkas statis
    } catch { /* kredensial rusak -> minta ulang */ }
  }
  return new Response('Perlu login.', { status: 401, headers: { 'www-authenticate': 'Basic realm="Review Konten", charset="UTF-8"', 'cache-control': 'no-store' } });
}
