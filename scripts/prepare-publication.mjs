#!/usr/bin/env node
// prepare-publication.mjs — menyiapkan paket publikasi (F2.2). TIDAK memposting apa pun.
//
// Syarat (semua dicek KODE, bukan LLM): ada record approval milik owner dengan keputusan TERAKHIR `approved`, dan hash isi
// paket saat ini (carousel + design + hash semua PNG slide dari disk) sama dengan hash di record. Setiap percobaan, lolos atau
// ditolak, ditulis ke audit log. Idempoten: approval + hash yang sama tidak membuat folder kedua.
//
// Pemakaian (dipanggil owner / Console, bukan agent):
//   node scripts/prepare-publication.mjs --issue <uuid> --carousel f.json --design f.json --render-dir dir [--out output/edukasiai]

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync, existsSync, readdirSync, appendFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { latestDecision } from './owner-approval.mjs';
import { packageContentHash } from '../plugins/aao-approval-gate/src/content-hash.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PNG_RE = /^slide-\d+\.png$/;
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

export class PublishError extends Error {}

export const slugify = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '') || 'carousel';
const jakartaDate = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format(d);

function audit(auditFile, entry) {
  mkdirSync(path.dirname(auditFile), { recursive: true });
  appendFileSync(auditFile, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
}

/** Hash isi paket dari berkas nyata di disk. */
export function currentPackageHash({ carousel, design, renderDir }) {
  const files = readdirSync(renderDir).filter((f) => PNG_RE.test(f)).sort();
  if (!files.length) throw new PublishError('tidak ada slide-*.png di folder render');
  return { hash: packageContentHash({ carousel, design }, Object.fromEntries(files.map((f) => [f, sha(readFileSync(path.join(renderDir, f)))]))), files };
}

function findExisting(outRoot, issueId, combined) {
  if (!existsSync(outRoot)) return null;
  for (const d of readdirSync(outRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    try {
      const m = JSON.parse(readFileSync(path.join(outRoot, d.name, 'meta.json'), 'utf8'));
      if (m.issue_id === issueId && m.content_hash === combined) return path.join(outRoot, d.name);
    } catch { /* bukan folder paket */ }
  }
  return null;
}

/**
 * @returns {{created:boolean, dir:string, hash:string}}
 * @throws {PublishError} bila tidak ada approval, ditolak, atau hash tidak cocok
 */
export function preparePublication({ issue, carousel, design, renderDir, approvalDir, token, issueStatus, outRoot = path.join(repoRoot, 'output', 'edukasiai'), auditFile = path.join(outRoot, '..', 'audit.log'), now = new Date() }) {
  const refuse = (event, message, extra = {}) => { audit(auditFile, { event, issue_id: issue.id, issue_identifier: issue.identifier, ...extra }); throw new PublishError(message); };

  // FIX-G2-03: paket hanya disiapkan bila owner sudah menutup issue (done); approval yang setengah jalan tidak cukup.
  if (issueStatus !== 'done') refuse('publish_refused_issue_not_done', `issue berstatus ${issueStatus ?? 'tidak diketahui'}; paket hanya disiapkan untuk issue done`);
  const rec = latestDecision(issue.id, approvalDir, token);
  if (!rec) refuse('publish_refused_no_approval', 'tidak ada record approval untuk issue ini');
  if (rec.decision !== 'approved') refuse('publish_refused_not_approved', `keputusan terakhir owner: ${rec.decision}; paket tidak disiapkan`, { record_id: rec.record_id });

  const { hash, files } = currentPackageHash({ carousel, design, renderDir });
  if (hash.combined !== rec.content_hash.combined) {
    refuse('publish_refused_hash_mismatch', 'isi paket berubah sejak approval (hash tidak cocok); minta approval baru', { record_id: rec.record_id, approved_hash: rec.content_hash.combined, current_hash: hash.combined });
  }

  const existing = findExisting(outRoot, issue.id, hash.combined);
  if (existing) { audit(auditFile, { event: 'publish_idempotent', issue_id: issue.id, record_id: rec.record_id, dir: existing }); return { created: false, dir: existing, hash: hash.combined }; }

  mkdirSync(outRoot, { recursive: true });
  const base = `${jakartaDate(now)}-${slugify(carousel.topic)}`;
  let final = path.join(outRoot, base);
  for (let i = 2; existsSync(final); i++) final = path.join(outRoot, `${base}-${i}`);
  const tmp = `${final}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    for (const f of files) copyFileSync(path.join(renderDir, f), path.join(tmp, f));
    const nl = '\n';
    writeFileSync(path.join(tmp, 'slides.md'), [`# ${carousel.topic}`, '', ...carousel.slides.flatMap((s) => [`## Slide ${s.index} (${s.role})`, `**${s.heading}**`, '', s.body, ''])].join(nl), 'utf8');
    writeFileSync(path.join(tmp, 'caption.txt'), `${carousel.caption}${nl}${nl}${carousel.hashtags.join(' ')}${nl}`, 'utf8');
    writeFileSync(path.join(tmp, 'sources.md'), ['# Sumber', '', ...carousel.sources.map((s) => `- ${s.source_name}: ${s.url}`), ''].join(nl), 'utf8');
    writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify({
      issue_id: issue.id, issue_identifier: issue.identifier, topic: carousel.topic, slide_count: files.length,
      content_hash: hash.combined, approval_record_id: rec.record_id, approved_at: rec.decided_at, prepared_at: now.toISOString(),
      posting: 'manual oleh owner; tidak ada posting otomatis',
    }, null, 2), 'utf8');
    renameSync(tmp, final);
  } catch (e) { rmSync(tmp, { recursive: true, force: true }); throw e; }
  audit(auditFile, { event: 'publish_prepared', issue_id: issue.id, record_id: rec.record_id, dir: final, content_hash: hash.combined });
  return { created: true, dir: final, hash: hash.combined };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const arg = (n) => (a.includes(n) ? a[a.indexOf(n) + 1] : undefined);
  const rd = (f) => JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));
  if (!arg('--issue') || !arg('--carousel') || !arg('--design') || !arg('--render-dir')) {
    console.error('Pemakaian: node scripts/prepare-publication.mjs --issue <uuid> --identifier EDU-n --carousel f --design f --render-dir dir [--out dir]');
    process.exit(64);
  }
  try {
    const { defaultApprovalDir, readOwnerToken } = await import('./owner-approval.mjs');
    const apiBase = arg('--api', 'http://127.0.0.1:3177/api');
    const issueRow = await (await fetch(`${apiBase}/issues/${arg('--issue')}`)).json();
    const r = preparePublication({ issue: { id: arg('--issue'), identifier: issueRow.identifier ?? arg('--identifier') ?? '' }, issueStatus: issueRow.status, token: readOwnerToken(), carousel: rd(arg('--carousel')), design: rd(arg('--design')), renderDir: arg('--render-dir'), approvalDir: defaultApprovalDir(), ...(arg('--out') ? { outRoot: path.resolve(arg('--out')) } : {}) });
    console.log(JSON.stringify(r, null, 2));
  } catch (e) { console.error(`DITOLAK: ${e.message}`); process.exit(2); }
}
