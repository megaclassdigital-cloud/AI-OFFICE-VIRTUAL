#!/usr/bin/env node
// owner-decide.mjs — keputusan owner atas satu issue (F2.1 + F2.3). Dijalankan OWNER, bukan agent.
//
//   reject  : catatan WAJIB. Record ditulis dulu (bukti), lalu issue dikembalikan ke Copywriter (status in_progress,
//             assignee Copywriter) dengan komentar yang memuat catatan owner sebagai konteks revisi.
//   approve : record approved terikat hash paket saat ini, komentar, status done. Paket publikasi disiapkan terpisah
//             (scripts/prepare-publication.mjs); approve TIDAK memposting apa pun.
//
// Pemakaian:
//   node scripts/owner-decide.mjs reject  --issue <uuid> --note "alasan" [--api http://127.0.0.1:3177/api]
//   node scripts/owner-decide.mjs approve --issue <uuid>
// Folder render selalu workspace/issues/<uuid>/render (tidak bisa diarahkan ke folder lain).
// Token owner dibaca dari .env (AAO_OWNER_TOKEN); tidak diterima lewat argumen supaya tidak masuk riwayat shell.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { sha256 } from '../plugins/aao-approval-gate/src/content-hash.js';
import { fileURLToPath } from 'node:url';
import { recordDecision, latestDecision, readOwnerToken, ApprovalError } from './owner-approval.mjs';
import { currentPackageHash } from './prepare-publication.mjs';
import { canTransition } from '../plugins/aao-approval-gate/src/lifecycle.js';
import { mkdirSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { makeRequest, managerRoutingRequestText, requestFile, managerFile, routingDirFor } from './revision-router.mjs';

export class DecideError extends Error {}

const HANDOFF_HASH_RE = /^- Hash isi paket \(sha256\): ([0-9a-f]{64})\s*$/gm;
const HANDOFF_SHEET_RE = /^- contact-sheet\.png \(sha256 ([0-9a-f]{64})\)\s*$/gm;
/** Semua kecocokan harus sama persis (satu nilai); lebih dari satu nilai berbeda = dokumen mencurigakan. */
const uniqueMatch = (re, text) => { const v = [...new Set([...String(text ?? '').matchAll(re)].map((m) => m[1]))]; return v.length === 1 ? v[0] : null; };
export const defaultRenderDir = (issueId, root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) => path.join(root, 'workspace', 'issues', issueId, 'render');

/**
 * @param {object} p
 * @param {{getIssue:Function, getDocument:Function, listAgents:Function, comment:Function, update:Function}} p.client
 */
/**
 * routing (opsional, ADR-0004): { dir, forceStage?, nowMs? }. Bila ada, reject TIDAK lagi hardcode ke Copywriter: Manager yang menentukan tahap awal revisi
 * (atau owner memaksa forceStage); kode menjalankannya lewat orkestrator (mode revisi). Tanpa routing = perilaku lama (kembali ke Copywriter).
 */
/** Penolakan baru untuk konten yang pernah ditolak: permintaan routing lama (sudah selesai, ada .done) dipindah ke routing/arsip supaya yang baru dibuat. */
export function archiveStaleRouting(dir, identifier) {
  const done = path.join(dir, identifier + '.done');
  if (!existsSync(done)) return false;
  const arch = path.join(dir, 'arsip'); mkdirSync(arch, { recursive: true });
  const stamp = Date.now();
  for (const f of [identifier + '.request.json', identifier + '.json', identifier + '.done', identifier + '.cancel']) {
    const p = path.join(dir, f);
    if (existsSync(p)) renameSync(p, path.join(arch, stamp + '-' + f));
  }
  return true;
}

export async function decide({ client, token, expectedToken, issueId, decision, note, renderDir = defaultRenderDir(issueId), approvalDir, routing = null }) {
  if (!['approved', 'rejected'].includes(decision)) throw new DecideError('decision harus approved atau rejected');
  if (decision === 'rejected' && !String(note ?? '').trim()) throw new DecideError('reject wajib disertai catatan');
  const issue = await client.getIssue(issueId);
  if (!issue) throw new DecideError('issue tidak ditemukan');
  if (issue.status !== 'in_review') throw new DecideError(issue.status === 'cancelled' ? 'konten ini sudah dibatalkan atau sudah ditolak sebelumnya, jadi tidak ada keputusan yang bisa diambil; buka kembali dulu bila ingin menolak lagi' : `issue berstatus ${issue.status}; keputusan hanya untuk issue in_review`);
  const to = decision === 'approved' ? 'done' : 'in_progress';
  if (!canTransition('owner', issue.status, to)) throw new DecideError(`transisi ${issue.status} -> ${to} tidak diizinkan`);

  const [carousel, design] = await Promise.all([client.getDocument(issueId, 'carousel'), client.getDocument(issueId, 'carousel-design')]);
  if (!carousel || !design) throw new DecideError('dokumen carousel/carousel-design tidak ada di issue');
  const { hash } = currentPackageHash({ carousel, design, renderDir });

  // FIX-G2-02: keputusan hanya untuk paket yang benar-benar diserahkan lewat handoff_to_owner (setelah QA lolos) dan
  // belum berubah sejak itu. Dokumen handoff hanya bisa ditulis tool plugin (PLUGIN_OWNED_KEYS).
  const handoff = await client.getText(issueId, 'handoff');
  const handedHash = uniqueMatch(HANDOFF_HASH_RE, handoff);
  if (!handedHash) throw new DecideError('issue tidak punya dokumen handoff dari handoff_to_owner (QA belum meloloskan paket); keputusan ditolak');
  if (handedHash !== hash.combined) throw new DecideError('isi paket berubah sejak handoff/QA (hash tidak sama dengan dokumen handoff); minta QA dan handoff ulang');
  // FIX-G3-03: gambar yang dilihat owner (contact-sheet.png) juga harus sama dengan yang dicatat saat handoff.
  const handedSheet = uniqueMatch(HANDOFF_SHEET_RE, handoff);
  let sheetNow = null;
  try { sheetNow = sha256(readFileSync(path.join(renderDir, 'contact-sheet.png'))); } catch { /* hilang */ }
  if (!handedSheet || handedSheet !== sheetNow) throw new DecideError('contact-sheet.png tidak sama dengan yang dicatat saat handoff (atau hilang); minta handoff ulang');

  let copywriter = null; let manager = null;
  if (decision === 'rejected' && routing) {
    if (!routing.forceStage) {
      manager = (await client.listAgents()).find((a) => /^manager$/i.test(a.name ?? '') || /^pm$/i.test(a.role ?? ''));
      if (!manager) throw new DecideError('agent Manager tidak ditemukan; reject dibatalkan sebelum menulis apa pun');
    }
  } else if (decision === 'rejected') {
    copywriter = (await client.listAgents()).find((a) => /copywriter/i.test(a.role ?? '') || /copywriter/i.test(a.name ?? ''));
    if (!copywriter) throw new DecideError('agent Copywriter tidak ditemukan; reject dibatalkan sebelum menulis apa pun');
  }

  // Record lebih dulu: bila langkah API gagal, keputusan owner tetap tercatat dan dapat dilanjutkan.
  // FIX-G2-03: ulangi aman. Bila keputusan identik (jenis, hash, catatan) sudah tercatat dan issue masih in_review
  // (langkah API sebelumnya gagal), pakai record itu dan lanjutkan langkah API; jangan menulis record kedua.
  const prev = latestDecision(issue.id, approvalDir, expectedToken);
  const same = prev && prev.decision === decision && prev.content_hash.combined === hash.combined && (prev.note ?? '') === (note?.trim() ?? '');
  const record = same ? prev : recordDecision({ token, expectedToken, issue: { id: issue.id, identifier: issue.identifier }, decision, note: note?.trim() || undefined, contentHash: hash, dir: approvalDir });

  if (decision === 'rejected' && routing) {
    // Permintaan routing ditulis SEKALI (ulangi aman: jendela batal tidak diulang). Kode orkestrator yang membaca dan menjalankannya.
    mkdirSync(routing.dir, { recursive: true });
    if (!same) archiveStaleRouting(routing.dir, issue.identifier);
    const reqPath = requestFile(routing.dir, issue.identifier);
    if (!existsSync(reqPath)) writeFileSync(reqPath, JSON.stringify(makeRequest({ identifier: issue.identifier, issueId: issue.id, reason: note, forceStage: routing.forceStage ?? null, nowMs: routing.nowMs ?? Date.now() }), null, 2) + String.fromCharCode(10), 'utf8');
    if (routing.forceStage) {
      await client.comment(issueId, [`Owner MENOLAK paket ini (record ${record.record_id}) dan memilih revisi dari tahap ${routing.forceStage}. Revisi dijadwalkan otomatis (jendela batal 60 detik).`, '', 'Catatan owner:', note.trim()].join('\n'));
      await client.update(issueId, { status: 'in_progress', assigneeAgentId: null });
    } else {
      await client.comment(issueId, managerRoutingRequestText({ identifier: issue.identifier, reason: note, file: managerFile(routing.dir, issue.identifier) }));
      await client.update(issueId, { status: 'in_progress', assigneeAgentId: manager.id });
    }
  } else if (decision === 'rejected') {
    await client.comment(issueId, [
      `Owner MENOLAK paket ini (record ${record.record_id}).`, '', 'Catatan owner:', note.trim(), '',
      'Revisi teks sesuai catatan, lalu jalankan ulang alur desain dan QA. Hash paket lama tidak berlaku lagi.',
    ].join('\n'));
    await client.update(issueId, { status: 'in_progress', assigneeAgentId: copywriter.id });
  } else {
    await client.comment(issueId, `Owner MENYETUJUI paket ini (record ${record.record_id}, hash ${record.content_hash.combined}). Paket publikasi disiapkan terpisah; tidak ada posting otomatis.`);
    await client.update(issueId, { status: 'done' });
  }
  return { record, issueStatus: to, returnedTo: copywriter?.name ?? manager?.name ?? null, routed: Boolean(routing), resumed: Boolean(same) };
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
    getText: async (id, key) => { const d = await j(`/issues/${id}/documents/${key}`).catch(() => null); return d?.body ?? null; },
    listAgents: () => j(`/companies/${companyId}/agents`),
    comment: (id, body) => j(`/issues/${id}/comments`, { method: 'POST', body: { body } }),
    update: (id, patch) => j(`/issues/${id}`, { method: 'PATCH', body: patch }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...a] = process.argv.slice(2);
  const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const decision = { approve: 'approved', reject: 'rejected' }[cmd];
  if (!decision || !arg('--issue')) {
    console.error('Pemakaian: node scripts/owner-decide.mjs approve|reject --issue <uuid> [--note "..."] [--stage copywriter|designer] [--api url]');
    process.exit(64);
  }
  const apiBase = arg('--api', 'http://127.0.0.1:3177/api');
  try {
    const { defaultApprovalDir } = await import('./owner-approval.mjs');
    const companies = await (await fetch(`${apiBase}/companies`)).json();
    const co = companies.find((c) => /edukasi/i.test(c.name) && !/mega\s*class/i.test(c.name));
    if (!co) throw new DecideError('company EdukasiAI tidak ditemukan');
    const token = readOwnerToken();
    const r = await decide({ client: httpClient(apiBase, co.id), token, expectedToken: token, issueId: arg('--issue'), decision, note: arg('--note'), approvalDir: defaultApprovalDir(), routing: decision === 'rejected' ? { dir: routingDirFor(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')), forceStage: arg('--stage') ?? null } : null });
    console.log(JSON.stringify({ decision, record_id: r.record.record_id, issueStatus: r.issueStatus, returnedTo: r.returnedTo }, null, 2));
  } catch (e) {
    console.error(`${e instanceof ApprovalError || e instanceof DecideError ? 'DITOLAK' : 'GAGAL'}: ${e.message}`);
    process.exitCode = 2;
  }
}
