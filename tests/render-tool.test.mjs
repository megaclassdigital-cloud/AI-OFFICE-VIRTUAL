// Test tool render_carousel (F1.8a): penjagaan path + satu render sungguhan lewat tool + hash identik antar-run.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, copyFileSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { designHash } from '../plugins/aao-approval-gate/src/provenance.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveRenderInputs, runRender, isInside, RenderInputError } from '../plugins/aao-approval-gate/src/render-tool.js';
import { makeAgentTools } from '../plugins/aao-approval-gate/src/agent-tools.js';
import { repoRoot } from './helpers.mjs';

const ID = randomUUID();
const wsDir = path.join(repoRoot, 'workspace', 'tests-render-tool');
const design = path.join(wsDir, 'design.json');
mkdirSync(wsDir, { recursive: true });
copyFileSync(path.join(repoRoot, 'divisions', 'edukasiai', 'brand', 'contoh-design.json'), design);

afterAll(() => {
  // Windows: hapus isi, bukan foldernya (EBUSY, lihat CLAUDE.md fakta 11)
  for (const d of [wsDir, path.join(repoRoot, 'workspace', 'issues', ID, 'render')]) {
    try { for (const f of readdirSync(d)) rmSync(path.join(d, f), { recursive: true, force: true }); } catch { /* sudah bersih */ }
  }
});

describe('penjagaan path', () => {
  it('isInside menolak traversal dan folder yang sama', () => {
    const ws = path.join(repoRoot, 'workspace');
    expect(isInside(ws, path.join(ws, 'a', 'b.json'))).toBe(true);
    expect(isInside(ws, path.join(ws, '..', 'secrets.json'))).toBe(false);
    expect(isInside(ws, ws)).toBe(false);
    expect(isInside(ws, 'C:\Windows\system.ini')).toBe(false);
  });
  it('menolak design di luar workspace, issueId bukan UUID, division berbahaya, berkas tak ada', () => {
    const base = { designPath: 'tests-render-tool/design.json', issueId: ID };
    expect(() => resolveRenderInputs({ ...base, designPath: '../package.json' })).toThrow(RenderInputError);
    expect(() => resolveRenderInputs({ ...base, designPath: path.join(repoRoot, 'package.json') })).toThrow(/workspace/);
    expect(() => resolveRenderInputs({ ...base, issueId: '../../x' })).toThrow(/UUID/);
    expect(() => resolveRenderInputs({ ...base, division: '..\evil' })).toThrow(/division/);
    expect(() => resolveRenderInputs({ ...base, designPath: 'tidak-ada.json' })).toThrow(/tidak ditemukan/);
  });
  it('keluaran selalu ke workspace/issues/<issueId>/render', () => {
    const r = resolveRenderInputs({ designPath: 'tests-render-tool/design.json', issueId: ID });
    expect(r.outDir).toBe(path.join(repoRoot, 'workspace', 'issues', ID, 'render'));
  });
});

describe('render sungguhan lewat tool', () => {
  it('render contoh-design: lulus, 6 PNG, hash tersedia; render ulang menghasilkan hash identik (AC1.5)', async () => {
    const a = await runRender({ designPath: 'tests-render-tool/design.json', issueId: ID });
    expect(a.stderr).toBe('');
    expect(a).toMatchObject({ exitCode: 0, passed: true, pngCount: 6 });
    expect(Object.keys(a.hashes)).toHaveLength(6);
    for (const f of Object.keys(a.hashes)) expect(existsSync(path.join(a.outDir, f))).toBe(true);
    const b = await runRender({ designPath: 'tests-render-tool/design.json', issueId: ID });
    expect(b.hashes).toEqual(a.hashes);
  }, 120_000);

  it('FIX-G2-05: render lewat handler membuat segel terikat ke isi design yang dibaca sebelum render', async () => {
    const state = new Map();
    const ctx = { state: { get: async (k) => state.get(k.stateKey) ?? null, set: async (k, v) => void state.set(k.stateKey, v) } };
    const r = await makeAgentTools(ctx).render_carousel({ issueId: ID, designPath: 'tests-render-tool/design.json' }, { companyId: 'c', agentId: 'a' });
    expect(r.data).toMatchObject({ ok: true, passed: true, sealed: true });
    const seal = state.get('seal');
    expect(seal.designHash).toBe(designHash(JSON.parse(readFileSync(design, 'utf8').replace(/^﻿/, ''))));
    expect(Object.keys(seal.hashes)).toHaveLength(6);
  }, 120_000);
  it('regresi: render ulang yang GAGAL tidak mewarisi laporan render sebelumnya (tidak ada segel basi)', async () => {
    const bad = path.join(wsDir, 'rusak.json');
    const d = JSON.parse(readFileSync(design, 'utf8').replace(/^﻿/, ''));
    d.slides[0].template = 'template-fiktif';
    writeFileSync(bad, JSON.stringify(d));
    const ok = await runRender({ designPath: 'tests-render-tool/design.json', issueId: ID });
    expect(ok.passed).toBe(true);
    const failed = await runRender({ designPath: 'tests-render-tool/rusak.json', issueId: ID });
    expect(failed).toMatchObject({ passed: false, pngCount: 0 });
    expect(failed.visualQa).toBeUndefined();
    expect(failed.hashes).toBeUndefined();
  }, 120_000);
  it('handler tool menolak path berbahaya sebagai ok:false (bukan exception)', async () => {
    const t = makeAgentTools({});
    const r = await t.render_carousel({ issueId: ID, designPath: '../package.json' }, { companyId: 'c', agentId: 'a' });
    expect(r.data.ok).toBe(false);
    expect(r.data.error).toMatch(/workspace/);
  });
});
