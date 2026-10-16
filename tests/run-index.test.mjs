import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { makeTmp } from './helpers.mjs';
import { writeContentHistory, renderHistory } from '../scripts/run-index.mjs';
import { planTidy, applyTidy } from '../scripts/tidy-workspace.mjs';

const put = (p, o) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, typeof o === 'string' ? o : JSON.stringify(o)); };

describe('RIWAYAT.md dan INDEX.md', () => {
  it('merangkum versi, putaran QA terarsip, dan penahanan aset; deterministik dan hanya menulis bila berubah', () => {
    const out = makeTmp();
    const base = path.join(out, 'runs', 'EDU-7');
    put(path.join(out, 'orders', 'EDU-7.json'), { title: 'Konten uji' });
    put(path.join(base, 'carousel.json'), { topic: 'Konten uji', slides: [{}, {}] });
    put(path.join(base, 'revision-1', 'run.json'), { runKey: 'EDU-7/revision-1', contentId: 'EDU-7', revision: 1, masterIdentifier: 'EDU-9', startStage: 'designer', createdAt: '2026-10-16T00:00:00Z' });
    put(path.join(base, 'revision-1', 'arsip', 'qa-putaran-1-designer', 'qa-result.json'), { passed: false, returnTo: ['designer'], notes: ['slide 2 foto berwatermark'] });
    put(path.join(base, 'revision-1', 'assets-hold.json'), { missing: [{ file: 'x.png' }] });
    expect(writeContentHistory(out, 'EDU-7')).toBe(true);
    const md = readFileSync(path.join(base, 'RIWAYAT.md'), 'utf8');
    expect(md).toContain('# EDU-7 — Konten uji');
    expect(md).toContain('EDU-9');
    expect(md).toContain('slide 2 foto berwatermark');
    expect(md).toContain('x.png');
    expect(existsSync(path.join(out, 'runs', 'INDEX.md'))).toBe(true);
    expect(writeContentHistory(out, 'EDU-7')).toBe(false); // tidak berubah -> tidak menulis
  });
});

describe('tidy-workspace', () => {
  it('memindahkan hanya sisa berkas agen ke _sisa-alat dan tidak menyentuh hasil kerja', () => {
    const out = makeTmp();
    put(path.join(out, 'runs', 'EDU-7', 'carousel.json'), '{}');
    put(path.join(out, 'runs', 'EDU-7', 'attach-payload.json'), '{}');
    put(path.join(out, 'complete-stage-params.json'), '{}');
    const plan = planTidy(out);
    expect(plan.map((p) => path.basename(p.from)).sort()).toEqual(['attach-payload.json', 'complete-stage-params.json']);
    expect(applyTidy(plan)).toBe(2);
    expect(existsSync(path.join(out, 'runs', 'EDU-7', 'carousel.json'))).toBe(true);
    expect(existsSync(path.join(out, 'runs', 'EDU-7', '_sisa-alat', 'attach-payload.json'))).toBe(true);
    expect(planTidy(out)).toEqual([]);
  });
});
