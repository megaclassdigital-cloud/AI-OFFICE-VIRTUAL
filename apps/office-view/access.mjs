// access.mjs — kontrol akses Office View untuk deployment (mode REVIEW untuk klien, mode OWNER dengan password untuk semua perintah).
// Prinsip: server yang menegakkan (bukan UI). Sesi = cookie bertanda tangan HMAC (HttpOnly, SameSite=Strict); password = hash scrypt di .env.
//   owner  : login password -> semua rute; perintah (non-GET) hanya untuk owner.
//   review : kunci review (tautan untuk klien) -> HANYA-BACA, daftar rute terbatas, data internal dibuang (rencana Manager, id issue, memori agent, log).
//   local  : localhost TANPA login (hanya bila bukan mode publik dan tanpa header proksi): baca penuh; perintah butuh login owner bila password sudah diatur.
//   anon   : jaringan luar tanpa sesi: hanya halaman login.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'aao_session';
export const TTL_MS = { owner: 12 * 3_600_000, review: 7 * 24 * 3_600_000 };
const b64 = (buf) => Buffer.from(buf).toString('base64url');

export const newSecret = () => randomBytes(32).toString('hex');
export const newReviewKey = () => randomBytes(18).toString('base64url');

export function signSession(role, expMs, secret) {
  const body = `${role}.${expMs}`;
  return `${body}.${b64(createHmac('sha256', secret).update(body).digest())}`;
}
/** Cookie -> { role, expMs } atau null (rusak, salah tanda tangan, kedaluwarsa, peran tidak dikenal). */
export function parseSession(cookieHeader, secret, nowMs) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(String(cookieHeader ?? ''));
  if (!m || !secret) return null;
  const [role, exp, sig] = decodeURIComponent(m[1]).split('.');
  if (!['owner', 'review'].includes(role) || !/^[0-9]+$/.test(exp ?? '') || !sig) return null;
  const want = b64(createHmac('sha256', secret).update(`${role}.${exp}`).digest());
  const a = Buffer.from(sig); const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return Number(exp) > nowMs ? { role, expMs: Number(exp) } : null;
}
export const sessionCookie = (role, secret, nowMs, { secure = false } = {}) => {
  const exp = nowMs + TTL_MS[role];
  return `${COOKIE}=${encodeURIComponent(signSession(role, exp, secret))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(TTL_MS[role] / 1000)}${secure ? '; Secure' : ''}`;
};
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'cf-connecting-ip', 'cf-ray', 'x-real-ip', 'true-client-ip'];
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** Permintaan benar-benar lokal: bukan mode publik, soket loopback, tanpa jejak proksi/tunnel (tunnel di mesin ini juga tampak dari 127.0.0.1!), Host = alamat lokal. */
export function isLocalRequest(req, { port, publicMode }) {
  if (publicMode) return false;
  if (!LOOPBACK.has(req.socket?.remoteAddress ?? '')) return false;
  if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  return [`127.0.0.1:${port}`, `localhost:${port}`].includes(String(req.headers.host ?? '').toLowerCase());
}

/** Daftar rute GET yang boleh dilihat klien (mode review). Selain ini ditolak. */
const REVIEW_ALLOW = [
  /^\/$/, /^\/index\.html$/, /^\/[A-Za-z0-9._-]+\.(js|css|html)$/, /^\/assets\/[A-Za-z0-9._\/-]+$/,
  /^\/api\/layout$/, /^\/api\/network$/, /^\/api\/inspect\/board$/, /^\/api\/inspect\/production$/, /^\/api\/inspect\/image$/,
  /^\/api\/access\/whoami$/,
];
export const reviewMayGet = (p) => REVIEW_ALLOW.some((re) => re.test(p));
/** Halaman/endpoint yang boleh dilihat tanpa sesi (supaya orang luar bisa login atau memakai tautan review). */
export const anonMayAccess = (p) => p === '/login.html' || p === '/review' || p.startsWith('/api/access/') || /^\/(style|access)\.(css|js)$/.test(p);

/** Data internal yang dibuang dari tampilan produksi untuk klien: rencana/instruksi Manager, id issue (tombol keputusan), catatan agen. */
export function sanitizeForReview(view) {
  if (!view || typeof view !== 'object') return view;
  const { manager, master, ...rest } = view;
  return { ...rest, master: master ? { hasHandoff: !!master.hasHandoff, status: master.status ?? null } : null, reviewMode: true };
}

/**
 * @param {object} cfg { port, publicMode, secret, ownerHash, reviewKey, verifyPassword(pw, hash), now, secureCookies }
 * @returns {{ classify(req): {role:string|null, passwordSet:boolean}, mayCommand(role): boolean, login(pw), reviewLogin(key) }}
 */
export function createAccess(cfg) {
  const now = cfg.now ?? Date.now;
  const passwordSet = () => Boolean(cfg.ownerHash());
  const classify = (req) => {
    const s = parseSession(req.headers.cookie, cfg.secret(), now());
    if (s) return { role: s.role, passwordSet: passwordSet() };
    if (isLocalRequest(req, cfg)) return { role: 'local', passwordSet: passwordSet() };
    return { role: null, passwordSet: passwordSet() };
  };
  /** Perintah (tombol, chat, jeda, brief): owner selalu; localhost bebas HANYA selama password belum diatur (jangan mengunci owner sebelum setup). */
  const mayCommand = (role) => role === 'owner' || (role === 'local' && !passwordSet());
  const login = (pw) => (cfg.ownerHash() && cfg.verifyPassword(String(pw ?? ''), cfg.ownerHash()) ? sessionCookie('owner', cfg.secret(), now(), { secure: cfg.secureCookies?.() }) : null);
  const reviewLogin = (key) => {
    const want = cfg.reviewKey();
    if (!want || typeof key !== 'string' || key.length !== want.length) return null;
    return timingSafeEqual(Buffer.from(key), Buffer.from(want)) ? sessionCookie('review', cfg.secret(), now(), { secure: cfg.secureCookies?.() }) : null;
  };
  return { classify, mayCommand, login, reviewLogin, passwordSet };
}
