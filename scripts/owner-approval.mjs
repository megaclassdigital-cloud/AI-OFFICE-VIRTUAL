#!/usr/bin/env node
// owner-approval.mjs — record approve/reject milik OWNER (F2.1).
//
// Otoritas: token owner lokal (AAO_OWNER_TOKEN di .env, dibuat oleh `init`). Token TIDAK pernah dikirim ke agent, tidak
// ada tool plugin yang menulis record ini, dan modul ini tidak diimpor oleh plugin. Record = satu berkas JSON per keputusan,
// append-only (flag `wx`), divalidasi terhadap schemas/approval-record.json. Hash isi dihitung pemanggil dari paket nyata
// (packageContentHash) dan wajib cocok dengan paket saat ini ketika F2.2 memakai record ini.
//
// Pemakaian:
//   node scripts/owner-approval.mjs init                       # buat AAO_OWNER_TOKEN di .env bila belum ada
//   node scripts/owner-approval.mjs show --issue <uuid>        # tampilkan keputusan terakhir issue
//
// Keputusan dibuat lewat fungsi recordDecision (dipanggil console/skrip owner di F2.2+), bukan lewat agent.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from 'node:fs';
import { randomUUID, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../schemas/validate.mjs';
import { canonicalJson } from '../plugins/aao-approval-gate/src/content-hash.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const defaultApprovalDir = () => path.join(process.env.AAO_REPO_ROOT ?? repoRoot, 'output', 'approvals');
const MIN_TOKEN = 32;

export class ApprovalError extends Error {}

export function readOwnerToken(envFile = path.join(repoRoot, '.env')) {
  if (!existsSync(envFile)) return null;
  const m = /^AAO_OWNER_TOKEN=(.+)$/m.exec(readFileSync(envFile, 'utf8').replace(/\r/g, ''));
  return m ? m[1].trim() : null;
}

export function initOwnerToken(envFile = path.join(repoRoot, '.env')) {
  if (readOwnerToken(envFile)) return { created: false };
  appendFileSync(envFile, `${existsSync(envFile) ? '\n' : ''}AAO_OWNER_TOKEN=${randomBytes(32).toString('hex')}\n`, 'utf8');
  return { created: true };
}

/** Tanda tangan record: HMAC-SHA256 atas JSON kanonik (tanpa field signature), kunci diturunkan dari token owner. */
export function signRecord(record, token) {
  const { signature: _omit, ...body } = record;
  const key = createHmac('sha256', String(token)).update('aao-approval-record-v1').digest();
  return createHmac('sha256', key).update(canonicalJson(body)).digest('hex');
}
export function verifyRecord(record, token) {
  if (!token || typeof record?.signature !== 'string') return false;
  const want = Buffer.from(signRecord(record, token), 'hex'); const got = Buffer.from(record.signature, 'hex');
  return want.length === got.length && timingSafeEqual(want, got);
}

function sameToken(a, b) {
  const x = Buffer.from(String(a ?? '')); const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length >= MIN_TOKEN && timingSafeEqual(x, y);
}

/**
 * @param {{token:string, expectedToken?:string, issue:{id:string,identifier:string}, decision:'approved'|'rejected', note?:string,
 *          contentHash:object, dir?:string, now?:Date}} p
 * @returns {object} record yang ditulis
 */
export function recordDecision({ token, expectedToken = readOwnerToken(), issue, decision, note, contentHash, dir = defaultApprovalDir(), now = new Date() }) {
  if (!expectedToken || expectedToken.length < MIN_TOKEN) throw new ApprovalError('token owner belum dibuat; jalankan: node scripts/owner-approval.mjs init');
  if (!sameToken(token, expectedToken)) throw new ApprovalError('token owner salah: keputusan ditolak');
  const record = {
    schema_version: 1, record_id: randomUUID(), issue_id: issue?.id, issue_identifier: issue?.identifier, decision,
    decided_at: now.toISOString(), decided_by: 'owner', ...(note ? { note } : {}), content_hash: contentHash,
  };
  record.signature = signRecord(record, expectedToken);
  const v = validate('approval-record', record);
  if (!v.ok) throw new ApprovalError(`record tidak valid: ${v.errors.map((e) => `${e.path || '/'} ${e.message}`).join('; ')}`);
  const issueDir = path.join(dir, record.issue_id);
  mkdirSync(issueDir, { recursive: true });
  // Nama berisi stempel waktu agar urutan terbaca; `wx` menolak menimpa record yang sudah ada.
  writeFileSync(path.join(issueDir, `${record.decided_at.replace(/[:.]/g, '-')}_${record.record_id}.json`), JSON.stringify(record, null, 2), { encoding: 'utf8', flag: 'wx' });
  return record;
}

/**
 * Semua record issue, tertua dulu. Record rusak, tidak valid skema, ATAU tanpa tanda tangan HMAC yang sah diabaikan
 * (tidak pernah dianggap approval). Tanpa token owner tidak ada yang bisa diverifikasi, jadi hasilnya kosong (gagal tertutup).
 */
export function readDecisions(issueId, dir = defaultApprovalDir(), token = readOwnerToken()) {
  if (!token) return [];
  const d = path.join(dir, issueId);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith('.json')).sort().flatMap((f) => {
    try {
      const r = JSON.parse(readFileSync(path.join(d, f), 'utf8').replace(/^﻿/, ''));
      return validate('approval-record', r).ok && r.issue_id === issueId && verifyRecord(r, token) ? [r] : [];
    } catch { return []; }
  });
}

export const latestDecision = (issueId, dir, token) => readDecisions(issueId, dir, token).at(-1) ?? null;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'init') {
    console.log(initOwnerToken().created ? 'AAO_OWNER_TOKEN dibuat di .env (jangan dibagikan, jangan di-commit).' : 'AAO_OWNER_TOKEN sudah ada; tidak diubah.');
  } else if (cmd === 'show' && rest[0] === '--issue' && rest[1]) {
    console.log(JSON.stringify(readDecisions(rest[1]), null, 2));
  } else {
    console.error('Pemakaian: node scripts/owner-approval.mjs init | show --issue <uuid>');
    process.exit(64);
  }
}
