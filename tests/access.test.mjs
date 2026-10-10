import { describe, it, expect } from 'vitest';
import { signSession, parseSession, sessionCookie, isLocalRequest, reviewMayGet, anonMayAccess, sanitizeForReview, createAccess, COOKIE, TTL_MS, newSecret, newReviewKey } from '../apps/office-view/access.mjs';
import { hashPin, verifyPin } from '../scripts/owner-pin.mjs';

const SECRET = 'a'.repeat(64);
const NOW = 1_700_000_000_000;
const req = (over = {}) => ({ headers: { host: '127.0.0.1:3190', ...(over.headers ?? {}) }, socket: { remoteAddress: '127.0.0.1', ...(over.socket ?? {}) } });

describe('sesi bertanda tangan', () => {
  it('sesi valid dibaca; salah tanda tangan, kedaluwarsa, peran asing, dan rusak ditolak', () => {
    const c = `${COOKIE}=${encodeURIComponent(signSession('owner', NOW + 1000, SECRET))}`;
    expect(parseSession(c, SECRET, NOW)).toEqual({ role: 'owner', expMs: NOW + 1000 });
    expect(parseSession(c, 'b'.repeat(64), NOW)).toBeNull();
    expect(parseSession(c, SECRET, NOW + 2000)).toBeNull();
    expect(parseSession(`${COOKIE}=${encodeURIComponent(signSession('admin', NOW + 1000, SECRET))}`, SECRET, NOW)).toBeNull();
    expect(parseSession(`${COOKIE}=sampah`, SECRET, NOW)).toBeNull();
    expect(parseSession('', SECRET, NOW)).toBeNull(); expect(parseSession(c, '', NOW)).toBeNull();
    // mengubah peran review menjadi owner tanpa kunci gagal
    const rev = decodeURIComponent(c.split('=')[1]).replace('owner', 'review');
    expect(parseSession(`${COOKIE}=${encodeURIComponent(rev)}`, SECRET, NOW)).toBeNull();
    const forged = signSession('review', NOW + 1000, SECRET).replace(/^review/, 'owner');
    expect(parseSession(`${COOKIE}=${encodeURIComponent(forged)}`, SECRET, NOW)).toBeNull();
  });
  it('cookie: HttpOnly, SameSite=Strict, masa berlaku sesuai peran, Secure bila diminta', () => {
    const o = sessionCookie('owner', SECRET, NOW, { secure: true });
    expect(o).toMatch(/HttpOnly/); expect(o).toMatch(/SameSite=Strict/); expect(o).toMatch(/Secure/); expect(o).toContain(`Max-Age=${TTL_MS.owner / 1000}`);
    expect(sessionCookie('review', SECRET, NOW)).not.toMatch(/Secure/);
  });
  it('rahasia dan kunci review acak dan cukup panjang', () => {
    expect(newSecret()).toMatch(/^[0-9a-f]{64}$/); expect(newReviewKey().length).toBeGreaterThanOrEqual(20); expect(newReviewKey()).not.toBe(newReviewKey());
  });
});

describe('permintaan lokal vs luar (tunnel di mesin yang sama tetap dianggap luar)', () => {
  const ctx = { port: 3190, publicMode: false };
  it('lokal murni diterima', () => { expect(isLocalRequest(req(), ctx)).toBe(true); expect(isLocalRequest(req({ headers: { host: 'localhost:3190' } }), ctx)).toBe(true); });
  it('jejak proksi/tunnel, host asing, atau soket luar => bukan lokal', () => {
    for (const h of ['x-forwarded-for', 'cf-connecting-ip', 'cf-ray', 'forwarded', 'x-real-ip']) expect(isLocalRequest(req({ headers: { [h]: '1.2.3.4' } }), ctx), h).toBe(false);
    expect(isLocalRequest(req({ headers: { host: 'office.contoh.com' } }), ctx)).toBe(false);
    expect(isLocalRequest(req({ socket: { remoteAddress: '192.168.1.20' } }), ctx)).toBe(false);
  });
  it('mode publik mematikan hak istimewa lokal sepenuhnya', () => { expect(isLocalRequest(req(), { ...ctx, publicMode: true })).toBe(false); });
});

describe('daftar rute review dan data internal', () => {
  it('klien boleh melihat papan, produksi, gambar, halaman statis; tidak boleh memori agent, chat, owner, log, berkas teks mentah', () => {
    for (const p of ['/', '/index.html', '/tv.js', '/style.css', '/assets/x/y.png', '/api/inspect/board', '/api/inspect/production', '/api/inspect/image', '/api/layout']) expect(reviewMayGet(p), p).toBe(true);
    for (const p of ['/api/inspect/agent', '/api/inspect/approvals', '/api/inspect/issue', '/api/inspect/file', '/api/inspect/files', '/api/talk/status', '/api/talk/outbox', '/api/owner/info', '/api/events', '/api/snapshot', '/api/replay', '/../etc/passwd', '/api/access/login']) expect(reviewMayGet(p), p).toBe(false);
  });
  it('tanpa sesi hanya halaman login/tautan review/akses', () => {
    for (const p of ['/login.html', '/review', '/api/access/login', '/api/access/whoami']) expect(anonMayAccess(p), p).toBe(true);
    for (const p of ['/', '/api/inspect/board', '/api/talk/status', '/tv.js']) expect(anonMayAccess(p), p).toBe(false);
  });
  it('sanitizeForReview membuang rencana Manager dan id issue, menandai mode review', () => {
    const v = sanitizeForReview({ prod: 'EDU-49', title: 'x', manager: { plans: [{ instruction: 'rahasia' }] }, master: { id: 'uuid', hasHandoff: true, status: 'in_review' }, slides: [1] });
    expect(v.manager).toBeUndefined(); expect(v.master).toEqual({ hasHandoff: true, status: 'in_review' }); expect(v.reviewMode).toBe(true); expect(v.slides).toEqual([1]);
    expect(JSON.stringify(v)).not.toMatch(/rahasia|uuid/);
    expect(sanitizeForReview(null)).toBeNull();
  });
});

describe('createAccess: peran dan hak perintah', () => {
  const hash = hashPin('kata-sandi-kuat');
  const mk = (over = {}) => createAccess({ port: 3190, publicMode: false, secret: () => SECRET, ownerHash: () => hash, reviewKey: () => 'KUNCI-REVIEW-0123456789', verifyPassword: verifyPin, now: () => NOW, ...over });

  it('login owner: password benar menghasilkan cookie, salah/kosong tidak; kunci review sama', () => {
    const a = mk();
    expect(a.login('kata-sandi-kuat')).toMatch(/aao_session=/); expect(a.login('salah')).toBeNull(); expect(a.login('')).toBeNull();
    expect(a.reviewLogin('KUNCI-REVIEW-0123456789')).toMatch(/aao_session=/); expect(a.reviewLogin('KUNCI-REVIEW-0123456780')).toBeNull(); expect(a.reviewLogin('pendek')).toBeNull();
    expect(mk({ ownerHash: () => null }).login('apa saja')).toBeNull(); expect(mk({ reviewKey: () => null }).reviewLogin('x')).toBeNull();
  });
  it('klasifikasi: sesi owner/review, lokal, dan luar tanpa sesi', () => {
    const a = mk();
    const owner = { ...req(), headers: { host: 'office.contoh.com', cookie: `${COOKIE}=${encodeURIComponent(signSession('owner', NOW + 5000, SECRET))}` } };
    const review = { ...req(), headers: { host: 'office.contoh.com', cookie: `${COOKIE}=${encodeURIComponent(signSession('review', NOW + 5000, SECRET))}` } };
    expect(a.classify(owner).role).toBe('owner'); expect(a.classify(review).role).toBe('review');
    expect(a.classify(req()).role).toBe('local');
    expect(a.classify(req({ headers: { host: 'office.contoh.com' } })).role).toBeNull();
  });
  it('hak perintah: owner ya; review/luar tidak; lokal hanya sebelum password diatur', () => {
    expect(mk().mayCommand('owner')).toBe(true); expect(mk().mayCommand('review')).toBe(false); expect(mk().mayCommand(null)).toBe(false);
    expect(mk().mayCommand('local')).toBe(false);                               // password sudah diatur: lokal pun harus login
    expect(mk({ ownerHash: () => null }).mayCommand('local')).toBe(true);       // belum diatur: jangan mengunci owner sebelum setup
  });
});
