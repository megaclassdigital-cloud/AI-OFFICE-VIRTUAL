// gate.mjs — gerbang akses Office View (ditegakkan di SERVER, bukan UI). Dipasang paling depan di server.mjs.
//   local  : permintaan benar-benar lokal (tanpa jejak proksi/tunnel, Host loopback): perilaku lama, tidak berubah.
//   review : pemegang tautan review (cookie bertanda tangan): HANYA-BACA, daftar rute terbatas, data internal dibuang.
//   anon   : selain itu (tunnel tanpa kunci, jaringan luar): hanya /review?key= dan /api/access/whoami; semua lain ditolak.
//   owner  : BELUM dihidupkan (tanpa AAO_OWNER_HASH). Mode owner untuk perangkat lain dibuat setelah read-only terbukti.
// Rahasia di .env (bukan repo): AAO_SESSION_SECRET, AAO_REVIEW_KEY. Dibuat oleh scripts/setup-review-access.mjs.
import { createAccess, reviewMayGet, sanitizeForReview } from './access.mjs';
import { scrubDeep } from '../../scripts/mirror/scrub.mjs';

const MIN = 60_000;
/** Rute tambahan untuk klien (di luar daftar bawaan access.mjs): status posting dan kantor otonom (sudah disaring di bawah). */
const EXTRA_REVIEW_GET = [/^\/api\/inspect\/agent$/, /^\/api\/inspect\/approvals$/, /^\/api\/inspect\/autopost$/, /^\/api\/inspect\/autonomy$/, /^\/api\/snapshot$/, /^\/api\/events$/, /^\/api\/replay$/, /^\/api\/status$/, /^\/api\/talk\/info$/, /^\/api\/owner\/info$/];
const IMAGE_OK = /^runs\/[A-Za-z0-9_-]+(?:\/revision-[0-9]+)?\/render\/[A-Za-z0-9._-]+\.png$/;

export const reviewMayGetAny = (p) => reviewMayGet(p) || EXTRA_REVIEW_GET.some((re) => re.test(p));

/** Gambar untuk klien hanya dari folder render konten (bukan bukti posting/layar akun). */
export const reviewMayImage = (relPath) => IMAGE_OK.test(String(relPath ?? '').replaceAll('\\', '/'));

/** Saring badan respons menurut rute untuk peran review. Murni; mengembalikan salinan. */
export function sanitizeBody(pathname, body) {
  if (!body || typeof body !== 'object') return body;
  if (pathname === '/api/inspect/production') return sanitizeForReview(body);
  if (pathname === '/api/events' || pathname === '/api/snapshot') {
    // Komentar agen/owner bisa memuat rencana Manager dan catatan internal: kutipan dibuang, kejadiannya tetap ada (animasi).
    const scrub = (e) => (e.issue ? { ...e, issue: { identifier: e.issue.identifier, title: e.issue.title } } : e); // id internal Paperclip tidak dikirim
    const events = (body.events ?? []).map((e) => scrub(e.type === 'comment' ? { type: 'comment', seq: e.seq, observedAt: e.observedAt, agentId: e.agentId, issue: e.issue ? { identifier: e.issue.identifier, title: e.issue.title } : null } : e));
    const { error, ...rest } = body; void error;
    return { ...rest, events };
  }
  if (pathname === '/api/status') return { connected: !!body.connected, lastOkAt: body.lastOkAt ?? null };
  if (pathname === '/api/inspect/autopost') {
    const s = body.status;
    return {
      status: s ? { paused: !!s.paused, cooldownHours: s.cooldownHours, approvedWaiting: s.approvedWaiting ?? 0, at: s.at, platforms: Object.fromEntries(Object.entries(s.platforms ?? {}).map(([k, v]) => [k, { live: !!v.live, lastPostAt: v.lastPostAt ?? null, nextAllowedAt: v.nextAllowedAt ?? null, postedTotal: v.postedTotal ?? 0 }])) } : null,
      recent: (body.recent ?? []).map((e) => ({ content: e.content, platform: e.platform, mode: e.mode, status: e.status, at: e.at })),
    };
  }
  if (pathname === '/api/inspect/autonomy') {
    const s = body.status;
    return {
      status: s ? { at: s.at, enabled: !!s.enabled, code: s.code, reason: s.reason, retryAtMs: s.retryAtMs ?? null, awaitingOwner: s.awaitingOwner ?? 0, briefsToday: s.briefsToday ?? 0, lastBriefAt: s.lastBriefAt ?? null, settings: { maxPerDay: s.settings?.maxPerDay, minGapMinutes: s.settings?.minGapMinutes, maxAwaitingOwner: s.settings?.maxAwaitingOwner, quietHours: s.settings?.quietHours } } : null,
      recent: (body.recent ?? []).map((e) => ({ atMs: e.atMs, withInsights: !!e.withInsights })),
      insights: body.insights ? { at: body.insights.at, source: body.insights.source, posts: body.insights.posts, analysis: body.insights.analysis ? { n: body.insights.analysis.n, notes: body.insights.analysis.notes, best: body.insights.analysis.best } : null } : null,
    };
  }
  if (pathname === '/api/talk/info' || pathname === '/api/owner/info') return { enabled: false };
  return body;
}

/** Kebijakan data keluar (mode review DAN monitor kedua di Vercel): saring per rute lalu bersihkan jalur lokal, id internal, dan rahasia. */
export const sanitizeForMirror = (pathname, body) => scrubDeep(sanitizeBody(pathname, body));

/** Pembatas laju percobaan kunci review yang salah (per alamat): 10 per menit, lalu ditolak sampai jendela lewat. */
export function createLimiter({ max = 10, windowMs = MIN, now = Date.now } = {}) {
  const hits = new Map();
  return (key) => {
    const t = now(); const arr = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    arr.push(t); hits.set(key, arr);
    if (hits.size > 500) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
    return arr.length <= max;
  };
}

/**
 * Buat gerbang. cfg: { port, publicMode, env: () => process.env-like, now }
 * gate(req, res, u, json) => { handled: boolean, role, json }  — `json` yang dipakai handler berikutnya (menyaring badan untuk review).
 */
export function createGate({ port, publicMode = false, env = () => process.env, now = Date.now }) {
  let secure = false; // diisi per permintaan (sinkron) untuk atribut Secure pada cookie
  let curPort = port; // port soket yang sebenarnya menerima permintaan (server bisa berjalan di port selain bawaan)
  const access = createAccess({
    get port() { return curPort; }, publicMode, now,
    secret: () => env().AAO_SESSION_SECRET || '',
    ownerHash: () => '', // mode owner dimatikan sampai read-only terbukti
    verifyPassword: () => false,
    reviewKey: () => env().AAO_REVIEW_KEY || '',
    secureCookies: () => secure,
  });
  const limiter = createLimiter({ now });
  const text = (res, code, body, extra = {}) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra }); res.end(body); };

  return function gate(req, res, u, json) {
    curPort = req.socket?.localPort ?? port;
    const p = u.pathname; secure = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
    const { role } = access.classify(req);
    if (p === '/review') {
      const ip = String(req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '?').split(',')[0].trim();
      if (!limiter(ip)) { text(res, 429, 'Terlalu banyak percobaan. Coba lagi sebentar lagi.', { 'retry-after': '60' }); return { handled: true, role }; }
      const cookie = access.reviewLogin(u.searchParams.get('key') ?? '');
      if (!cookie) { text(res, 403, 'Tautan review tidak valid.'); return { handled: true, role }; }
      res.writeHead(302, { location: '/', 'set-cookie': cookie, 'cache-control': 'no-store' }); res.end(); return { handled: true, role: 'review' };
    }
    if (p === '/api/access/whoami') { json(res, 200, { role: role === 'local' ? 'owner' : role, readOnly: role === 'review' }); return { handled: true, role }; }
    if (role === 'local') return { handled: false, role, json };               // desktop: perilaku lama
    if (role === 'owner') return { handled: false, role, json };               // (belum aktif)
    if (role !== 'review') { text(res, 401, 'Akses ditolak. Buka tautan review yang diberikan.'); return { handled: true, role }; }
    // ── peran review: hanya GET, daftar rute terbatas, badan disaring ──
    if (req.method !== 'GET') { json(res, 405, { error: 'mode review hanya-baca' }); return { handled: true, role }; }
    if (!reviewMayGetAny(p)) { json(res, 403, { error: 'tidak tersedia di mode review' }); return { handled: true, role }; }
    if (p === '/api/inspect/image' && !reviewMayImage(u.searchParams.get('path'))) { json(res, 403, { error: 'gambar tidak tersedia di mode review' }); return { handled: true, role }; }
    const filtered = (r, code, body) => json(r, code, sanitizeForMirror(p, body));
    return { handled: false, role, json: filtered };
  };
}
