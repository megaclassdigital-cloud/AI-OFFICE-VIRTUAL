#!/usr/bin/env node
// owner-decide.mjs — keputusan owner atas satu issue (F2.1 + F2.3). Dijalankan OWNER, bukan agent.
//
//   reject  : catatan WAJIB. Record ditulis dulu (bukti), lalu issue dikembalikan ke Copywriter (status in_progress,
//             assignee Copywriter) dengan komentar yang memuat catatan owner sebagai konteks revisi.
//   approve : record approved terikat hash paket saat ini, komentar, status done. Paket publikasi disiapkan terpisah
//             (scripts/prepare-publication.mjs); approve TIDAK memposting apa pun.
//
// Pemakaian:
//   node scripts/owner-decide.mjs reject  --issue <uuid> --note "alasan" --render-dir <dir> [--api http://127.0.0.1:3177/api]
//   node scripts/owner-decide.mjs approve --issue <uuid> --render-dir <dir>
// Token owner dibaca dari .env (AAO_OWNER_TOKEN); tidak diterima lewat argumen supaya tidak masuk riwayat shell.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordDecision, readOwnerToken, ApprovalError } from './owner-approval.mjs';
import { currentPackageHash } from './prepare-publication.mjs';
import { canTransition } from '../plugins/aao-approval-gate/src/lifecycle.js';

export class DecideError extends Error {}

/**
 * @param {object} p
 * @param {{getIssue:Function, getDocument:Function, listAgents:Function, comment:Function, update:Function}} p.client
 */
export async function decide({ client, token, expectedToken, issueId, decision, note, renderDir, approvalDir }) {
  if (!['approved', 'rejected'].includes(decision)) throw new DecideError('decision harus approved atau rejected');
  if (decision === 'rejected' && !String(note ?? '').trim()) throw new DecideError('reject wajib disertai catatan');
  const issue = await client.getIssue(issueId);
  if (!issue) throw new DecideError('issue tidak ditemukan');
  if (issue.status !== 'in_review') throw new DecideError(`issue berstatus ${issue.status}; keputusan hanya untuk issue in_review`);
  const to = decision === 'approved' ? 'done' : 'in_progress';
  if (!canTransition('owner', issue.status, to)) throw new DecideError(`transisi ${issue.status} -> ${to} tidak diizinkan`);

  const [carousel, design] = await Promise.all([client.getDocument(issueId, 'carousel'), client.getDocument(issueId, 'carousel-design')]);
  if (!carousel || !design) throw new DecideError('dokumen carousel/carousel-design tidak ada di issue');
  const { hash } = currentPackageHash({ carousel, design, renderDir });

  let copywriter = null;
  if (decision === 'rejected') {
    copywriter = (await client.listAgents()).find((a) => /copywriter/i.test(a.role ?? '') || /copywriter/i.test(a.name ?? ''));
    if (!copywriter) throw new DecideError('agent Copywriter tidak ditemukan; reject dibatalkan sebelum menulis apa pun');
  }

  // Record lebih dulu: bila langkah API gagal, keputusan owner tetap tercatat dan dapat dilanjutkan.
  const record = recordDecision({ token, expectedToken, issue: { id: issue.id, identifier: issue.identifier }, decision, note: note?.trim() || undefined, contentHash: hash, dir: approvalDir });

  if (decision === 'rejected') {
    await client.comment(issueId, [
      `Owner MENOLAK paket ini (record ${record.record_id}).`, '', 'Catatan owner:', note.trim(), '',
      'Revisi teks sesuai catatan, lalu jalankan ulang alur desain dan QA. Hash paket lama tidak berlaku lagi.',
    ].join('\n'));
    await client.update(issueId, { status: 'in_progress', assigneeAgentId: copywriter.id });
  } else {
    await client.comment(issueId, `Owner MENYETUJUI paket ini (record ${record.record_id}, hash ${record.content_hash.combined}). Paket publikasi disiapkan terpisah; tidak ada posting otomatis.`);
    await client.update(issueId, { status: 'done' });
  }
  return { record, issueStatus: to, returnedTo: copywriter?.name ?? null };
}

/** Klien HTTP Paperclip. Node fetch + Buffer: aman untuk teks Indonesia panjang (lihat CLAUDE.md fakta 5). */
export function httpClient(apiBase, companyId) {
  const j = async (p, o = {}) => {
    const body = o.body === undefined ? undefined : Buffer.from(JSON.stringify(o.body), 'utf8');
    const r = await fetch(apiBase + p, { method: o.method ?? 'GET', headers: body ? { 'content-type': 'application/json', 'content-length': String(body.length) } : {}, body });
    const t = await r.text();
    if (!r.ok) throw new DecideError(`Paperclip HTTP ${r.status} ${p}: ${t.slice(0, 200)}`);
    try { return JSON.parse(t); } catch { return t; }
  };
  return {
    getIssue: (id) => j(`/issues/${id}`),
    getDocument: async (id, key) => { const d = await j(`/issues/${id}/documents/${key}`).catch(() => null); return d?.body ? JSON.parse(d.body) : null; },
    listAgents: () => j(`/companies/${companyId}/agents`),
    comment: (id, body) => j(`/issues/${id}/comments`, { method: 'POST', body: { body } }),
    update: (id, patch) => j(`/issues/${id}`, { method: 'PATCH', body: patch }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...a] = process.argv.slice(2);
  const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const decision = { approve: 'approved', reject: 'rejected' }[cmd];
  if (!decision || !arg('--issue') || !arg('--render-dir')) {
    console.error('Pemakaian: node scripts/owner-decide.mjs approve|reject --issue <uuid> --render-dir <dir> [--note "..."] [--api url]');
    process.exit(64);
  }
  const apiBase = arg('--api', 'http://127.0.0.1:3177/api');
  try {
    const { defaultApprovalDir } = await import('./owner-approval.mjs');
    const companies = await (await fetch(`${apiBase}/companies`)).json();
    const co = companies.find((c) => /edukasi/i.test(c.name) && !/mega\s*class/i.test(c.name));
    if (!co) throw new DecideError('company EdukasiAI tidak ditemukan');
    const token = readOwnerToken();
    const r = await decide({ client: httpClient(apiBase, co.id), token, expectedToken: token, issueId: arg('--issue'), decision, note: arg('--note'), renderDir: path.resolve(arg('--render-dir')), approvalDir: defaultApprovalDir() });
    console.log(JSON.stringify({ decision, record_id: r.record.record_id, issueStatus: r.issueStatus, returnedTo: r.returnedTo }, null, 2));
  } catch (e) {
    console.error(`${e instanceof ApprovalError || e instanceof DecideError ? 'DITOLAK' : 'GAGAL'}: ${e.message}`);
    process.exit(2);
  }
}
