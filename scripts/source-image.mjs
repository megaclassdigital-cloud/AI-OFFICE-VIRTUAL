// source-image.mjs — gambar dari SUMBER PRIMER berita (halaman yang sudah divalidasi Verifier), dipakai SEBELUM pencarian Google/Bing.
// Mengapa: gambar utama halaman sumber (og:image) adalah foto/tampilan aslinya, relevan dengan beritanya, tanpa CAPTCHA, dan jejak sumbernya jelas.
// Murni (tanpa jaringan, tanpa browser): memilih sumber untuk sebuah slide dan membaca URL gambar dari HTML. Pengunduhan dilakukan capture-asset.mjs
// langsung ke folder run (tidak lewat unduhan browser, jadi folder Downloads dan unduhan lain milik owner tidak tersentuh).

const PRIVATE_HOST_RE = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i;
/** Alamat IP literal yang bukan publik (loopback, privat, link-local, metadata cloud). */
export function isPrivateIp(host) {
  const h = String(host).replace(/^\[|\]$/g, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return /^(::1?|fe80:|fc|fd)/i.test(h);
}

/** Hanya https publik tanpa kredensial. URL dari riset/HTML tidak boleh mengarahkan pengambil ke jaringan internal (SSRF). */
export function isPublicHttpsUrl(u) {
  try {
    const x = new URL(String(u));
    if (x.protocol !== 'https:' || x.username || x.password) return false;
    if (PRIVATE_HOST_RE.test(x.hostname) || isPrivateIp(x.hostname)) return false;
    return x.hostname.includes('.') || x.hostname.includes(':');
  } catch { return false; }
}

const attrsOf = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
};
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

/** URL gambar utama dari HTML, urut prioritas: og:image:secure_url, og:image, twitter:image, link rel=image_src. Hanya https publik, tanpa duplikat. */
export function extractImageUrls(html, baseUrl) {
  const head = String(html).slice(0, 400_000);
  const found = [];
  const rank = { 'og:image:secure_url': 0, 'og:image': 1, 'og:image:url': 2, 'twitter:image': 3, 'twitter:image:src': 4 };
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    const key = (a.property ?? a.name ?? '').toLowerCase();
    if (key in rank && a.content) found.push({ r: rank[key], u: a.content });
  }
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    if (/image_src/i.test(a.rel ?? '') && a.href) found.push({ r: 5, u: a.href });
  }
  const out = [];
  for (const f of found.sort((x, y) => x.r - y.r)) {
    let abs; try { abs = new URL(decode(f.u), baseUrl).href; } catch { continue; }
    if (isPublicHttpsUrl(abs) && !/\.svg(\?|$)|favicon|sprite/i.test(abs) && !out.includes(abs)) out.push(abs);
  }
  return out;
}

/** Judul halaman (og:title atau <title>) sebagai bukti sumber gambar. */
export function extractTitle(html) {
  const head = String(html).slice(0, 400_000);
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) { const a = attrsOf(m[0]); if ((a.property ?? '').toLowerCase() === 'og:title' && a.content) return decode(a.content).slice(0, 200); }
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  return t ? decode(t[1].replace(/\s+/g, ' ')).slice(0, 200) : null;
}

/**
 * Sumber primer untuk satu slide: kandidat riset yang DIRUJUK slide itu dan terverifikasi. Hanya bila tepat SATU sumber
 * (slide rangkuman yang merujuk banyak berita tidak diwakili gambar satu berita). Mengembalikan { id, url, title, imageUrl } atau null.
 * imageUrl = gambar yang sudah ditemukan Researcher (candidate.image_url), dicoba lebih dulu.
 */
export function pickSource({ slideIndex, carousel, research, verification }) {
  const slide = (carousel?.slides ?? []).find((s) => s.index === slideIndex);
  const refs = [...new Set(slide?.sourceRefs ?? [])];
  const ok = new Set((verification?.results ?? []).filter((r) => r.status === 'verified').map((r) => r.candidateId ?? r.id));
  const usable = verification ? refs.filter((id) => ok.has(id)) : refs;
  if (usable.length !== 1) return null;
  const c = (research?.candidates ?? []).find((x) => x.id === usable[0]);
  if (!c || !isPublicHttpsUrl(c.url)) return null;
  return { id: c.id, url: c.url, title: c.title ?? null, imageUrl: c.image_url && isPublicHttpsUrl(c.image_url) ? c.image_url : null };
}
