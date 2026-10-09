// Jalur keputusan owner di Office View (opt-in --enable-owner; ADR-0004): tombol Setujui / Tolak berPIN.
// Semua keputusan tetap lewat decide() (hash paket + handoff + record bertanda tangan); modul ini hanya pintu HTTP-nya.
// Loopback + same-origin + PIN (hash scrypt di .env) + pembatas percobaan salah. Tidak ada LLM di sini.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { verifyPin, readPinHash, createLimiter } from '../../scripts/owner-pin.mjs';
import { decide, httpClient, DecideError } from '../../scripts/owner-decide.mjs';
import { ApprovalError, readOwnerToken, defaultApprovalDir } from '../../scripts/owner-approval.mjs';
import { routingDirFor, cancelFile, doneFile, ROUTE_STAGES } from '../../scripts/revision-router.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^EDU-[0-9]+$/;
const MAX_NOTE = 2000;

export function createOwner({ base, port, repoRoot, envFile = path.join(repoRoot, '.env'), now = Date.now, limiter = createLimiter({ now }), deps = {} }) {
  const decideFn = deps.decide ?? decide;
  const clientFn = deps.httpClient ?? httpClient;
  const tokenFn = deps.readOwnerToken ?? (() => readOwnerToken(path.join(repoRoot, '.env')));
  const approvalDirFn = deps.approvalDir ?? (() => defaultApprovalDir());
  const routingDir = routingDirFor(repoRoot);

  const sameOrigin = (req) => {
    if (req.headers.host !== `127.0.0.1:${port}`) return false;
    const o = req.headers.origin;
    return !o || o === `http://127.0.0.1:${port}`;
  };
  async function readBody(req, limit = 32 * 1024) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('terlalu besar'), { code: 413 }); chunks.push(c); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }

  /** Verifikasi PIN dengan pembatas. Mengembalikan { ok } atau { status, error }. */
  function checkPin(pin) {
    const stored = readPinHash(envFile);
    if (!stored) return { status: 503, error: 'PIN owner belum diatur: jalankan "node scripts/owner-pin.mjs set" di terminal Anda lalu mulai ulang Office View' };
    const lock = limiter.check();
    if (lock.locked) return { status: 429, error: `terlalu banyak PIN salah; coba lagi dalam ${Math.ceil(lock.retryAfterMs / 60_000)} menit` };
    if (!verifyPin(String(pin ?? ''), stored)) { limiter.fail(); return { status: 403, error: 'PIN salah' }; }
    limiter.ok();
    return { ok: true };
  }

  async function pendingRoutings() {
    if (!existsSync(routingDir)) return [];
    const out = [];
    for (const n of await readdir(routingDir)) {
      if (!n.endsWith('.request.json')) continue;
      const id = n.replace('.request.json', '');
      if (!ID_RE.test(id) || existsSync(doneFile(routingDir, id))) continue;
      try {
        const r = JSON.parse((await readFile(path.join(routingDir, n), 'utf8')).replace(/^﻿/, ''));
        out.push({ identifier: id, issueId: r.issueId ?? null, reason: String(r.reason ?? '').slice(0, 300), forceStage: r.forceStage ?? null, readyAt: r.readyAt, requestedAt: r.requestedAt, managerAnswered: existsSync(path.join(routingDir, `${id}.json`)), cancelled: existsSync(cancelFile(routingDir, id)) });
      } catch { /* abaikan berkas rusak */ }
    }
    return out;
  }

  /** Returns true when the request was handled here. */
  return async function handle(req, res, u, json) {
    if (!u.pathname.startsWith('/api/owner')) return false;
    try {
      if (u.pathname === '/api/owner/info' && req.method === 'GET') { json(res, 200, { enabled: true, pinSet: Boolean(readPinHash(envFile)), stages: ROUTE_STAGES }); return true; }
      if (u.pathname === '/api/owner/routing' && req.method === 'GET') { json(res, 200, { now: now(), pending: await pendingRoutings() }); return true; }
      if (req.method !== 'POST') { json(res, 405, { error: 'metode tidak didukung' }); return true; }
      if (!sameOrigin(req)) { json(res, 403, { error: 'origin ditolak' }); return true; }
      const body = await readBody(req);

      if (u.pathname === '/api/owner/decide') {
        const { issueId, decision, note, stage, pin } = body;
        if (!UUID_RE.test(String(issueId ?? ''))) { json(res, 400, { error: 'issueId tidak valid' }); return true; }
        if (!['approve', 'reject'].includes(decision)) { json(res, 400, { error: 'decision harus approve atau reject' }); return true; }
        const text = typeof note === 'string' ? note.trim() : '';
        if (decision === 'reject' && !text) { json(res, 400, { error: 'alasan tolak wajib diisi' }); return true; }
        if (text.length > MAX_NOTE) { json(res, 400, { error: `alasan maksimal ${MAX_NOTE} karakter` }); return true; }
        if (stage != null && stage !== '' && !ROUTE_STAGES.includes(stage)) { json(res, 400, { error: `tahap tujuan harus ${ROUTE_STAGES.join(' atau ')} atau kosong (Manager menentukan)` }); return true; }
        const pc = checkPin(pin);
        if (!pc.ok) { json(res, pc.status, { error: pc.error }); return true; }
        try {
          const company = (await (await fetch(`${base}/api/companies`)).json()).find((c) => /edukasi/i.test(c.name) && !/mega\s*class/i.test(c.name));
          if (!company) throw new DecideError('company EdukasiAI tidak ditemukan');
          const token = tokenFn();
          const r = await decideFn({
            client: clientFn(`${base}/api`, company.id), token, expectedToken: token, issueId, decision: decision === 'approve' ? 'approved' : 'rejected', note: text || undefined,
            approvalDir: approvalDirFn(), routing: decision === 'reject' ? { dir: routingDir, forceStage: stage || null } : null,
          });
          json(res, 200, { ok: true, decision, status: r.issueStatus, returnedTo: r.returnedTo, record: r.record?.record_id ?? null });
        } catch (e) {
          json(res, e instanceof DecideError || e instanceof ApprovalError ? 409 : 502, { error: String(e?.message ?? e).slice(0, 300) });
        }
        return true;
      }

      if (u.pathname === '/api/owner/cancel-revision') {
        const { identifier, pin } = body;
        if (!ID_RE.test(String(identifier ?? ''))) { json(res, 400, { error: 'identifier tidak valid' }); return true; }
        const pc = checkPin(pin);
        if (!pc.ok) { json(res, pc.status, { error: pc.error }); return true; }
        const pend = (await pendingRoutings()).find((p) => p.identifier === identifier);
        if (!pend) { json(res, 404, { error: 'tidak ada revisi yang menunggu untuk berkas itu' }); return true; }
        if (now() >= pend.readyAt) { json(res, 409, { error: 'jendela batal 60 detik sudah lewat; revisi sedang dijadwalkan' }); return true; }
        mkdirSync(routingDir, { recursive: true });
        writeFileSync(cancelFile(routingDir, identifier), JSON.stringify({ at: now() }) + String.fromCharCode(10), 'utf8');
        json(res, 200, { ok: true, identifier });
        return true;
      }
      json(res, 404, { error: 'endpoint tidak dikenal' });
      return true;
    } catch (e) {
      json(res, e.code === 413 ? 413 : 400, { error: String(e?.message ?? e).slice(0, 200) });
      return true;
    }
  };
}
