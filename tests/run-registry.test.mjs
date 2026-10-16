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

import { humanizeIds, revisiTitle, masterLabelMap } from '../scripts/run-registry.mjs';
describe('filing: kode konten tetap, nomor master internal', () => {
  it('humanizeIds mengganti nomor master dengan label konten, nomor lain dibiarkan', () => {
    const map = new Map([['EDU-105', 'EDU-97 · revisi 1']]);
    expect(humanizeIds('EDU-105 keluaran Designer; konten EDU-97; issue EDU-114', map)).toBe('EDU-97 · revisi 1 keluaran Designer; konten EDU-97; issue EDU-114');
    expect(humanizeIds('EDU-105 saja', new Map())).toBe('EDU-105 saja');
  });
  it('revisiTitle tidak menggandakan awalan Revisi', () => {
    expect(revisiTitle('Revisi Revisi EDU-97: ditolak owner')).toBe('Revisi EDU-97: ditolak owner');
    expect(revisiTitle('Carousel tren AI')).toBe('Revisi Carousel tren AI');
  });
  it('masterLabelMap kosong untuk folder tanpa runs', () => {
    expect(masterLabelMap('D:/folder-tidak-ada-xyz').size).toBe(0);
  });
});
