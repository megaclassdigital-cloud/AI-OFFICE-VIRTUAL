// Test F2.2: AC2.1 (tanpa approval ditolak), AC2.2 (hash berubah ditolak), AC2.3 (idempoten), + audit log.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync, copyFileSync, appendFileSync, utimesSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { recordDecision } from '../scripts/owner-approval.mjs';
import { preparePublication, currentPackageHash, slugify, PublishError } from '../scripts/prepare-publication.mjs';
import { makeTmp, repoRoot } from './helpers.mjs';

const TOKEN = 'c'.repeat(64);
const rd = (rel) => JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8').replace(/^﻿/, ''));
const clone = (o) => JSON.parse(JSON.stringify(o));
const ISSUE = { id: randomUUID(), identifier: 'EDU-21' };
const renderDir = path.join(repoRoot, 'workspace', 'issues', ISSUE.id, 'render');
let carousel; let design;

beforeAll(() => {
  mkdirSync(renderDir, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'render.mjs'), '--design', path.join(repoRoot, 'fixtures/golden/valid/04-carousel-design.json'), '--out', renderDir], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`render gagal: ${r.stderr}`);
  carousel = rd('fixtures/golden/valid/03-carousel.json');
  design = rd('fixtures/golden/valid/04-carousel-design.json');
}, 300_000);
afterAll(() => { try { for (const f of readdirSync(renderDir)) rmSync(path.join(renderDir, f), { recursive: true, force: true }); } catch { /* bersih */ } });

function env() {
  const root = makeTmp('aao-pub-');
  return { approvalDir: path.join(root, 'approvals'), outRoot: path.join(root, 'out', 'edukasiai'), auditFile: path.join(root, 'out', 'audit.log'), root };
}
const approve = (e, decision = 'approved', hash = currentPackageHash({ carousel, design, renderDir }).hash, extra = {}) =>
  recordDecision({ token: TOKEN, expectedToken: TOKEN, issue: ISSUE, decision, contentHash: hash, dir: e.approvalDir, ...extra });
const args = (e, over = {}) => ({ issue: ISSUE, carousel, design, renderDir, approvalDir: e.approvalDir, token: TOKEN, issueStatus: 'done', outRoot: e.outRoot, auditFile: e.auditFile, now: new Date('2026-10-08T03:00:00Z'), ...over });
const audits = (e) => (existsSync(e.auditFile) ? readFileSync(e.auditFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

describe('prepare_publication', () => {
  it('AC2.1: tanpa approval ditolak dan tercatat di audit log; tidak ada folder output', () => {
    const e = env();
    expect(() => preparePublication(args(e))).toThrow(/tidak ada record approval/);
    expect(audits(e).map((a) => a.event)).toEqual(['publish_refused_no_approval']);
    expect(existsSync(e.outRoot)).toBe(false);
  });
  it('FIX-G2-03: issue belum done (decide setengah jalan) ditolak dan tercatat', () => {
    const e = env();
    approve(e);
    expect(() => preparePublication(args(e, { issueStatus: 'in_review' }))).toThrow(/paket hanya disiapkan untuk issue done/);
    expect(audits(e)[0].event).toBe('publish_refused_issue_not_done');
    expect(existsSync(e.outRoot)).toBe(false);
  });
  it('FIX-G2-01: record approval palsu tanpa tanda tangan tidak membuka publikasi', () => {
    const e = env();
    const real = approve(e);
    const { signature: _s, ...forged } = real;
    const d = path.join(e.approvalDir, ISSUE.id);
    for (const f of readdirSync(d)) rmSync(path.join(d, f));
    writeFileSync(path.join(d, '1_forged.json'), JSON.stringify({ ...forged, record_id: randomUUID() }));
    expect(() => preparePublication(args(e))).toThrow(/tidak ada record approval/);
  });
  it('keputusan terakhir rejected: ditolak', () => {
    const e = env();
    approve(e, 'rejected', undefined, { note: 'perlu revisi' });
    expect(() => preparePublication(args(e))).toThrow(/rejected/);
    expect(audits(e)[0].event).toBe('publish_refused_not_approved');
  });
  it('approve valid: folder berisi slide PNG, slides.md, caption.txt, sources.md, meta.json', () => {
    const e = env();
    const rec = approve(e);
    const r = preparePublication(args(e));
    expect(r.created).toBe(true);
    expect(path.basename(r.dir)).toBe(`2026-10-08-${slugify(carousel.topic)}`);
    expect(slugify(carousel.topic).length).toBeLessThanOrEqual(50);
    const files = readdirSync(r.dir).sort();
    expect(files).toEqual(expect.arrayContaining(['caption.txt', 'meta.json', 'slides.md', 'sources.md', 'slide-01.png']));
    expect(files.filter((f) => /^slide-\d+\.png$/.test(f))).toHaveLength(carousel.slides.length);
    const meta = JSON.parse(readFileSync(path.join(r.dir, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({ issue_id: ISSUE.id, content_hash: rec.content_hash.combined, approval_record_id: rec.record_id });
    expect(readFileSync(path.join(r.dir, 'caption.txt'), 'utf8')).toContain('#EdukasiAI');
    expect(readFileSync(path.join(r.dir, 'sources.md'), 'utf8')).toContain('apnews.com');
    expect(audits(e).at(-1).event).toBe('publish_prepared');
  });
  it('AC2.3: approval yang sama diproses dua kali menghasilkan satu folder', () => {
    const e = env();
    approve(e);
    const a = preparePublication(args(e));
    const b = preparePublication(args(e, { now: new Date('2026-10-09T03:00:00Z') }));
    expect([a.created, b.created]).toEqual([true, false]);
    expect(b.dir).toBe(a.dir);
    expect(readdirSync(e.outRoot)).toHaveLength(1);
    expect(audits(e).map((x) => x.event)).toEqual(['publish_prepared', 'publish_idempotent']);
  });
  it('AC2.2: teks diubah setelah approve ditolak (hash mismatch) dan tercatat', () => {
    const e = env();
    approve(e);
    const changed = clone(carousel); changed.caption += ' diubah';
    expect(() => preparePublication(args(e, { carousel: changed }))).toThrow(PublishError);
    expect(audits(e)[0]).toMatchObject({ event: 'publish_refused_hash_mismatch' });
    expect(audits(e)[0].approved_hash).not.toBe(audits(e)[0].current_hash);
    expect(existsSync(e.outRoot)).toBe(false);
  });
  it('AC2.2: satu PNG diganti setelah approve ditolak', () => {
    const e = env();
    approve(e);
    const png = path.join(renderDir, 'slide-03.png');
    const orig = readFileSync(png);
    writeFileSync(png, Buffer.concat([orig, Buffer.from('x')]));
    try { expect(() => preparePublication(args(e))).toThrow(/hash tidak cocok/); } finally { writeFileSync(png, orig); }
  });
  it('reject lalu approve ulang dengan hash baru: paket baru, folder lama tidak ditimpa', () => {
    const e = env();
    approve(e);
    const first = preparePublication(args(e));
    const changed = clone(carousel); changed.hashtags = [...changed.hashtags, '#Baru'];
    const h2 = currentPackageHash({ carousel: changed, design, renderDir }).hash;
    approve(e, 'approved', h2, { now: new Date(Date.now() + 5000) });
    const second = preparePublication(args(e, { carousel: changed }));
    expect(second.created).toBe(true);
    expect(second.dir).not.toBe(first.dir);
    expect(readdirSync(e.outRoot)).toHaveLength(2);
  });
  it('FIX-G2-04: PNG ditukar saat disalin terdeteksi lewat hash salinan; tidak ada folder paket, kunci dilepas', () => {
    const e = env();
    approve(e);
    const corrupt = (src, dst) => { copyFileSync(src, dst); if (dst.endsWith('slide-02.png')) appendFileSync(dst, 'x'); };
    expect(() => preparePublication(args(e, { copyFile: corrupt }))).toThrow(/berubah saat disalin/);
    expect(audits(e).at(-1).event).toBe('publish_refused_changed_during_copy');
    expect(readdirSync(e.outRoot).filter((n) => !n.startsWith('.'))).toEqual([]);
    expect(preparePublication(args(e)).created).toBe(true); // percobaan berikutnya (tanpa gangguan) berhasil
  });
  it('FIX-G2-04: kunci per issue: proses lain sedang menyiapkan -> ditolak; kunci basi diambil alih; kunci dilepas setelah sukses', () => {
    const e = env();
    approve(e);
    mkdirSync(e.outRoot, { recursive: true });
    const lock = path.join(e.outRoot, `.lock-${ISSUE.id}`);
    mkdirSync(lock);
    expect(() => preparePublication(args(e))).toThrow(/proses lain sedang menyiapkan/);
    expect(audits(e).at(-1).event).toBe('publish_refused_busy');
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(lock, old, old); // kunci basi (proses mati)
    const r = preparePublication(args(e));
    expect(r.created).toBe(true);
    expect(existsSync(lock)).toBe(false);
    expect(preparePublication(args(e)).created).toBe(false);
  });
  it('FIX-G2-04: dua proses Node paralel pada approval yang sama menghasilkan satu folder paket', async () => {
    const e = env();
    approve(e);
    const script = `
      import { preparePublication } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'scripts/prepare-publication.mjs')).href)};
      import { readFileSync } from 'node:fs';
      const a = JSON.parse(process.argv[2]);
      const rd = (f) => JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
      try {
        const r = preparePublication({ ...a, carousel: rd(a.carouselFile), design: rd(a.designFile), now: new Date(a.now) });
        console.log(JSON.stringify({ ok: true, created: r.created }));
      } catch (err) { console.log(JSON.stringify({ ok: false, error: err.message })); }
    `;
    const f = path.join(e.root, 'child.mjs');
    writeFileSync(f, script);
    const payload = JSON.stringify({ issue: ISSUE, issueStatus: 'done', renderDir, approvalDir: e.approvalDir, token: TOKEN, outRoot: e.outRoot, auditFile: e.auditFile, now: '2026-10-08T03:00:00Z', carouselFile: path.join(repoRoot, 'fixtures/golden/valid/03-carousel.json'), designFile: path.join(repoRoot, 'fixtures/golden/valid/04-carousel-design.json') });
    const runChild = () => new Promise((res) => { const c = spawn(process.execPath, [f, payload], { encoding: 'utf8' }); let o = ''; c.stdout.on('data', (d) => (o += d)); c.on('close', () => res(JSON.parse(o.trim().split(/\r?\n/).at(-1)))); });
    const results = await Promise.all([runChild(), runChild(), runChild()]);
    expect(readdirSync(e.outRoot).filter((n) => !n.startsWith('.'))).toHaveLength(1);
    expect(results.filter((r) => r.ok && r.created)).toHaveLength(1);
    for (const r of results.filter((x) => !x.ok)) expect(r.error).toMatch(/proses lain sedang menyiapkan/);
  }, 60_000);
  it('slugify aman', () => {
    expect(slugify('Ünïcode & "Judul" Panjang!!')).toBe('unicode-judul-panjang');
    expect(slugify('???')).toBe('carousel');
  });
});
