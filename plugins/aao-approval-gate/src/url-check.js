// Pemeriksaan URL dan tanggal yang deterministik (F1.3). Generik untuk semua division.
//
// Hasil di sini adalah FAKTA yang dihitung kode (status HTTP, redirect, umur artikel), bukan penilaian LLM.
// Isi halaman diperlakukan sebagai data: hanya dipindai untuk tanda injeksi prompt dan tidak pernah
// dikembalikan sebagai teks yang bisa dibaca agent sebagai instruksi.

import { isIP } from 'node:net';

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

function isPrivateHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (v === 6) return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
  return false;
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
export async function checkUrl(url, { timeoutMs = 10_000, maxRedirects = 5, policy = STRICT_POLICY, fetchImpl = fetch } = {}) {
  const result = { ok: false, redirects: 0, suspectedInjection: false };
  let current = url;
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      const bad = policyViolation(current, policy);
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
