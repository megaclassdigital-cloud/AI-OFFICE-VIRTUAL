// FIX-G1-05: tool khusus peran hanya untuk agent yang berhak; gagal tertutup bila pemetaan tidak ada.
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadToolRoles, checkToolRole, gateTool, GATED_TOOLS } from '../plugins/aao-approval-gate/src/tool-roles.js';
import { makeTmp, repoRoot } from './helpers.mjs';

const MAP = { verify_candidate: ['Verifier'], render_carousel: ['Designer'], qa_submit_result: ['QA'], handoff_to_owner: ['QA'] };
const ok = async () => ({ data: { ok: true } });

describe('checkToolRole', () => {
  it('agent yang berhak lolos; agent lain ditolak dengan pesan jelas', () => {
    expect(checkToolRole('qa_submit_result', 'QA', MAP)).toBeNull();
    expect(checkToolRole('qa_submit_result', 'Copywriter', MAP)).toMatch(/tidak diizinkan.*hanya: QA/);
    expect(checkToolRole('render_carousel', 'Researcher', MAP)).toMatch(/tidak diizinkan/);
    expect(checkToolRole('verify_candidate', 'Verifier', MAP)).toBeNull();
  });
  it('gagal tertutup: tool dibatasi tanpa pemetaan ditolak; tool bebas (post_comment) tidak terpengaruh', () => {
    for (const t of GATED_TOOLS) expect(checkToolRole(t, 'QA', {})).toMatch(/belum dikonfigurasi/);
    expect(checkToolRole('post_comment', 'Researcher', {})).toBeNull();
    expect(checkToolRole('attach_file', null, MAP)).toBeNull();
  });
  it('nama agent tidak diketahui ditolak untuk tool dibatasi', () => {
    expect(checkToolRole('handoff_to_owner', null, MAP)).toMatch(/tidak dapat dipastikan/);
  });
});

describe('loadToolRoles', () => {
  it('membaca divisions/*/tool-roles.json repo ini dan memetakan empat tool khusus peran', () => {
    const r = loadToolRoles(repoRoot);
    expect(r.errors).toEqual([]);
    expect(r.map).toMatchObject(MAP);
    expect(Object.keys(r.map).every((k) => GATED_TOOLS.includes(k))).toBe(true);
  });
  it('menggabungkan beberapa division (union) dan melaporkan berkas rusak', () => {
    const root = makeTmp('aao-roles-');
    for (const [d, body] of [['a', '{"qa_submit_result":["QA"]}'], ['b', '{"qa_submit_result":["QA2"],"render_carousel":["D"]}'], ['c', '{ rusak']]) {
      mkdirSync(path.join(root, 'divisions', d), { recursive: true });
      writeFileSync(path.join(root, 'divisions', d, 'tool-roles.json'), body);
    }
    const r = loadToolRoles(root);
    expect(r.map.qa_submit_result.sort()).toEqual(['QA', 'QA2']);
    expect(r.map.render_carousel).toEqual(['D']);
    expect(r.errors).toHaveLength(1);
  });
  it('bentuk salah (bukan array nama) dilaporkan sebagai galat, bukan dianggap izin', () => {
    const root = makeTmp('aao-roles-');
    mkdirSync(path.join(root, 'divisions', 'x'), { recursive: true });
    writeFileSync(path.join(root, 'divisions', 'x', 'tool-roles.json'), '{"qa_submit_result":"QA"}');
    const r = loadToolRoles(root);
    expect(r.map).toEqual({});
    expect(r.errors[0]).toMatch(/harus array/);
  });
});

describe('gateTool', () => {
  const gate = (name, agentName, map = MAP, errors = []) => gateTool(name, ok, { getRoles: () => ({ map, errors }), resolveName: async () => agentName });
  it('menjalankan handler hanya untuk peran yang berhak', async () => {
    expect((await gate('qa_submit_result', 'QA')({}, {})).data.ok).toBe(true);
    const denied = await gate('qa_submit_result', 'Designer')({}, {});
    expect(denied.data).toMatchObject({ ok: false });
    expect(denied.error).toMatch(/tidak diizinkan/);
  });
  it('resolveName yang gagal = ditolak untuk tool dibatasi', async () => {
    const g = gateTool('handoff_to_owner', ok, { getRoles: () => ({ map: MAP, errors: [] }), resolveName: async () => { throw new Error('host down'); } });
    expect((await g({}, {})).data.ok).toBe(false);
  });
  it('tanpa pemetaan sama sekali: semua tool dibatasi ditolak', async () => {
    for (const t of GATED_TOOLS) expect((await gate(t, 'QA', {})({}, {})).data.ok, t).toBe(false);
  });
});

describe('terpasang di plugin.js', () => {
  it('setiap tool terdaftar dibungkus gateTool (bukan handler mentah)', () => {
    const src = readFileSync(path.join(repoRoot, 'plugins/aao-approval-gate/src/plugin.js'), 'utf8');
    expect(src).toContain('gateTool(name, agentTools[name], roleGate)');
    expect(src).not.toMatch(/ctx\.tools\.register\(name, def, agentTools\[name\]\)/);
  });
});
