// Pemeriksaan URL dan tanggal yang deterministik (F1.3). Generik untuk semua division.
//
// Hasil di sini adalah FAKTA yang dihitung kode (status HTTP, redirect, umur artikel), bukan penilaian LLM.
// Isi halaman diperlakukan sebagai data: hanya dipindai untuk tanda injeksi prompt dan tidak pernah
// dikembalikan sebagai teks yang bisa dibaca agent sebagai instruksi.

import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

export const STRICT_POLICY = Object.freeze({ allowHttp: false, allowPrivate: false });
const MAX_BODY_BYTES = 64 * 1024;

const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts?)/i,
  /abaikan (semua )?(instruksi|perintah) (sebelumnya|di atas)/i,
  /(mark|tandai|set)\b[^.\n]{0,40}\b(as )?(approved|verified|lolos|disetujui)/i,
  /system prompt/i,
  /you are now\b/i,
  /(send|kirim)\b[^.\n]{0,60}\b(api key|token|password|credential)/i,
];

export function detectInjection(text) {
  if (typeof text !== 'string') return false;
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

/** IPv4 "a.b.c.d" -> true bila termasuk rentang yang tidak boleh diakses dari luar (privat, loopback, link-local, CGNAT, dsb). */
function isPrivateV4(h) {
  const [a, b, c] = h.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||                       // "this network", privat, loopback
    (a === 100 && b >= 64 && b <= 127) ||                      // CGNAT 100.64.0.0/10
    (a === 169 && b === 254) ||                                // link-local / metadata cloud
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||          // 192.0.0.0/24, TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) ||                   // benchmark 198.18.0.0/15
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || // TEST-NET-2/3
    a >= 224                                                   // multicast + reserved + broadcast
  );
}

/** Pecah IPv6 menjadi 8 hextet (angka). Mengembalikan null bila bukan IPv6 valid. */
function v6Groups(h) {
  if (isIP(h) !== 6) return null;
  let s = h;
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) { const [w, x, y, z] = v4[1].split('.').map(Number); s = s.replace(v4[1], ((w << 8) | x).toString(16) + ':' + ((y << 8) | z).toString(16)); }
  const [head, tail] = s.split('::');
  const hs = head ? head.split(':') : [];
  const ts = tail === undefined ? [] : tail ? tail.split(':') : [];
  const fill = tail === undefined ? 0 : 8 - hs.length - ts.length;
  return [...hs, ...Array(fill).fill('0'), ...ts].map((g) => parseInt(g || '0', 16));
}

function isPrivateV6(h) {
  const g = v6Groups(h);
  if (!g || g.length !== 8) return true; // tidak terurai: anggap berbahaya
  const v4of = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.every((x) => x === 0)) return true;                                   // :: (unspecified)
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;        // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateV4(v4of(g[6], g[7])); // ::ffff:a.b.c.d (IPv4-mapped)
  if (g.slice(0, 6).every((x) => x === 0)) return isPrivateV4(v4of(g[6], g[7]));                      // ::a.b.c.d (IPv4-compatible)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateV4(v4of(g[6], g[7])); // NAT64 64:ff9b::/96
  if (g[0] === 0x2002) return isPrivateV4(v4of(g[1], g[2]));                  // 6to4 2002::/16 membawa IPv4
  if ((g[0] & 0xfe00) === 0xfc00) return true;                                // fc00::/7 unique-local
  if ((g[0] & 0xffc0) === 0xfe80) return true;                                // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true;                                // ff00::/8 multicast
  return false;
}

export function isPrivateAddress(addr) {
  const h = String(addr).replace(/^\[|\]$/g, '').toLowerCase();
  const v = isIP(h);
  if (v === 4) return isPrivateV4(h);
  if (v === 6) return isPrivateV6(h);
  return false;
}

function isPrivateHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  return isPrivateAddress(h);
}

/**
 * Pemeriksaan DNS (anti DNS rebinding): nama host publik yang ternyata menunjuk ke alamat privat/loopback ditolak.
 * Dilakukan di SETIAP lompatan redirect. Catatan jujur: fetch me-resolve nama lagi sendiri, jadi masih ada jendela
 * kecil antara pemeriksaan ini dan koneksi; menutupnya penuh butuh pinning IP di dispatcher (belum dibangun).
 */
export async function dnsViolation(urlString, policy, lookupImpl = dnsLookup) {
  if (policy.allowPrivate) return null;
  let host;
  try { host = new URL(urlString).hostname.replace(/^\[|\]$/g, ''); } catch { return 'URL tidak valid'; }
  if (isIP(host)) return null; // sudah diperiksa langsung oleh policyViolation
  try {
    const addrs = await lookupImpl(host, { all: true, verbatim: true });
    if (!addrs.length) return 'nama host tidak ter-resolve';
    const bad = addrs.find((a) => isPrivateAddress(a.address));
    return bad ? `host menunjuk ke alamat privat/lokal (${bad.address})` : null;
  } catch (e) { return `DNS gagal: ${e.code ?? e.message}`; }
}

/** Kembalikan alasan penolakan (string) atau null bila URL boleh diakses menurut kebijakan. */
export function policyViolation(urlString, policy) {
  let u;
  try { u = new URL(urlString); } catch { return 'URL tidak valid'; }
  if (u.protocol !== 'https:' && !(policy.allowHttp && u.protocol === 'http:')) return `skema ${u.protocol} tidak diizinkan`;
  if (!policy.allowPrivate && isPrivateHost(u.hostname)) return 'host privat/lokal tidak diizinkan';
  return null;
}

/**
 * @returns {{ok:boolean, httpStatus?:number, finalUrl?:string, redirects:number, error?:string, suspectedInjection:boolean}}
 */
export async function checkUrl(url, { timeoutMs = 10_000, maxRedirects = 5, policy = STRICT_POLICY, fetchImpl = fetch, lookupImpl = dnsLookup } = {}) {
  const result = { ok: false, redirects: 0, suspectedInjection: false };
  let current = url;
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      const bad = policyViolation(current, policy) ?? await dnsViolation(current, policy, lookupImpl);
      if (bad) return { ...result, finalUrl: current, error: bad };
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { ...result, finalUrl: current, error: `timeout setelah ${timeoutMs} ms` };
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), remaining);
      let res;
      try {
        res = await fetchImpl(current, { method: 'GET', redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': 'AAO-Verifier/1.0', accept: 'text/html,*/*;q=0.5' } });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          result.redirects += 1;
          if (result.redirects > maxRedirects) return { ...result, httpStatus: res.status, finalUrl: current, error: `lebih dari ${maxRedirects} redirect` };
          current = new URL(res.headers.get('location'), current).toString();
          continue;
        }
        result.httpStatus = res.status;
        result.finalUrl = current;
        if (res.status >= 200 && res.status < 300) {
          result.ok = true;
          result.suspectedInjection = detectInjection(await readLimited(res));
        } else {
          result.error = `HTTP ${res.status}`;
        }
        return result;
      } finally {
        clearTimeout(timer);
        try { await res?.body?.cancel?.(); } catch { /* sudah selesai */ }
      }
    }
  } catch (e) {
    const aborted = e?.name === 'AbortError';
    return { ...result, finalUrl: current, error: aborted ? `timeout setelah ${timeoutMs} ms` : `gagal terhubung: ${e?.cause?.code ?? e?.message ?? e}` };
  }
}

async function readLimited(res) {
  const reader = res.body?.getReader?.();
  if (!reader) return '';
  const dec = new TextDecoder();
  let got = 0;
  let text = '';
  while (got < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    text += dec.decode(value, { stream: true });
  }
  return text;
}

/** published_at ('YYYY-MM-DD' atau ISO) harus dalam `windowDays` terakhir dan tidak di masa depan. */
export function checkDateWindow(publishedAt, { nowMs = Date.now(), windowDays = 7 } = {}) {
  const t = Date.parse(publishedAt ?? '');
  if (!Number.isFinite(t)) return { ok: false, publishedAt: String(publishedAt ?? ''), error: 'tanggal tidak dapat dibaca' };
  const ageDays = (nowMs - t) / 86_400_000;
  if (ageDays < -1) return { ok: false, publishedAt, ageDays: round(ageDays), error: 'tanggal di masa depan' };
  if (ageDays > windowDays) return { ok: false, publishedAt, ageDays: round(ageDays), error: `lebih lama dari ${windowDays} hari` };
  return { ok: true, publishedAt, ageDays: round(ageDays) };
}

const round = (n) => Math.round(n * 100) / 100;

/** Gabungan: hasil sesuai bentuk `checks` di schemas/verification-result.json (tanpa claimFound, itu penilaian LLM). */
export async function verifyCandidate({ url, publishedAt }, opts = {}) {
  const u = await checkUrl(url, opts);
  const urlReachable = { ok: u.ok };
  if (u.httpStatus !== undefined) urlReachable.httpStatus = u.httpStatus;
  if (u.finalUrl) urlReachable.finalUrl = u.finalUrl;
  if (u.error) urlReachable.error = u.error;
  return {
    checks: { urlReachable, dateWithinWindow: checkDateWindow(publishedAt, opts) },
    redirects: u.redirects,
    suspectedInjection: u.suspectedInjection,
  };
}
