import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { contentOf, revisionOf, runKeyFor, runDirOf, labelOf, listRevisions, latestRunKey, nextRunKey, writeRunMeta, readRunMeta, masterIdentifierOf, runKeyForMaster, RUN_KEY_RE } from '../scripts/run-registry.mjs';
import { makeTmp } from './helpers.mjs';

const mk = (out, key) => mkdirSync(runDirOf(out, key), { recursive: true });

describe('run-registry: kode konten tetap, revisi di dalam folder yang sama', () => {
  it('kunci, label, dan path', () => {
    expect(runKeyFor('EDU-49', 0)).toBe('EDU-49');
    expect(runKeyFor('EDU-49', 2)).toBe('EDU-49/revision-2');
    expect(contentOf('EDU-49/revision-2')).toBe('EDU-49'); expect(contentOf('EDU-49')).toBe('EDU-49');
    expect(revisionOf('EDU-49/revision-2')).toBe(2); expect(revisionOf('EDU-49')).toBe(0);
    expect(labelOf('EDU-49')).toBe('EDU-49'); expect(labelOf('EDU-49/revision-1')).toBe('EDU-49 · revisi 1');
    const out = path.join('X', 'agent');
    expect(runDirOf(out, 'EDU-49/revision-1')).toBe(path.join('X', 'agent', 'runs', 'EDU-49', 'revision-1'));
  });
  it('RUN_KEY_RE menolak path berbahaya atau bentuk lain', () => {
    for (const ok of ['EDU-1', 'EDU-49/revision-3']) expect(RUN_KEY_RE.test(ok), ok).toBe(true);
    for (const bad of ['../EDU-1', 'EDU-49/../EDU-2', 'EDU-49/revision-', 'EDU-49/revision-1/x', 'edu-49', 'EDU-49/rev-1', '']) expect(RUN_KEY_RE.test(bad), bad).toBe(false);
  });
  it('revisi berikutnya menaikkan nomor tanpa mengubah kode konten', () => {
    const out = makeTmp('aao-reg-');
    mk(out, 'EDU-49');
    expect(listRevisions(out, 'EDU-49')).toEqual([]);
    expect(nextRunKey(out, 'EDU-49')).toBe('EDU-49/revision-1');
    expect(latestRunKey(out, 'EDU-49')).toBe('EDU-49');
    mk(out, 'EDU-49/revision-1'); mk(out, 'EDU-49/revision-2');
    expect(listRevisions(out, 'EDU-49')).toEqual([1, 2]);
    expect(nextRunKey(out, 'EDU-49')).toBe('EDU-49/revision-3');
    expect(latestRunKey(out, 'EDU-49')).toBe('EDU-49/revision-2');
    expect(nextRunKey(out, 'EDU-77')).toBe('EDU-77/revision-1');
  });
  it('issue master revisi (EDU-53) dipetakan ke folder konten asli lewat run.json', () => {
    const out = makeTmp('aao-reg2-');
    mk(out, 'EDU-49');
    writeRunMeta(out, 'EDU-49/revision-1', { masterIdentifier: 'EDU-53', masterIssueId: 'uuid', from: 'EDU-49' });
    expect(readRunMeta(out, 'EDU-49/revision-1')).toMatchObject({ runKey: 'EDU-49/revision-1', contentId: 'EDU-49', revision: 1, masterIdentifier: 'EDU-53' });
    expect(masterIdentifierOf(out, 'EDU-49/revision-1')).toBe('EDU-53');
    expect(masterIdentifierOf(out, 'EDU-49')).toBe('EDU-49');
    expect(runKeyForMaster(out, 'EDU-53')).toBe('EDU-49/revision-1');
    expect(runKeyForMaster(out, 'EDU-49')).toBe('EDU-49');
    expect(runKeyForMaster(out, 'EDU-99')).toBeNull();
  });
});
