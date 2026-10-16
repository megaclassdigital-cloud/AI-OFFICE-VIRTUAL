import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeTmp } from './helpers.mjs';
import { writeOverride, readValidOverride, llmWithOverride, overrideComment } from '../scripts/owner-override.mjs';
import { checkQaResult } from '../scripts/orchestrator-core.mjs';

const REJECT = { passed: false, returnTo: ['designer'], llmReview: { textOk: true, designOk: false }, designReview: { layout: false, photo: true, font: true }, notes: ['slide 4 layout: ruang atas kosong'] };
const put = (dir, obj, name = 'qa-result.json') => writeFileSync(path.join(dir, name), JSON.stringify(obj));

describe('owner-override (keputusan owner menggantikan penolakan QA)', () => {
  it('tulis hanya bila QA benar-benar menolak; tanpa hasil QA atau QA lolos ditolak', () => {
    const d = makeTmp();
    expect(() => writeOverride(d)).toThrow(/tidak ada qa-result/);
    put(d, { passed: true });
    expect(() => writeOverride(d)).toThrow(/tidak menolak/);
  });
  it('override sah selama hasil QA tidak berubah; gugur otomatis bila QA menulis hasil baru', () => {
    const d = makeTmp();
    put(d, REJECT);
    const rec = writeOverride(d, { note: 'owner puas dengan tampilannya', nowMs: Date.UTC(2026, 9, 16, 12, 0) });
    expect(rec.accepted).toBe(true); expect(rec.qa.notes).toEqual(REJECT.notes);
    expect(readValidOverride(d)).toMatchObject({ accepted: true, note: 'owner puas dengan tampilannya' });
    put(d, { ...REJECT, notes: ['temuan baru'] });            // QA menilai ulang
    expect(readValidOverride(d)).toBeNull();
  });
  it('hasil QA asli tidak diubah oleh override', () => {
    const d = makeTmp();
    put(d, REJECT);
    writeOverride(d);
    expect(JSON.parse(require_read(path.join(d, 'qa-result.json')))).toEqual(REJECT);
  });
  it('llmWithOverride hanya melonggarkan penilaian desain; penilaian teks tetap', () => {
    expect(llmWithOverride({ textOk: true, designOk: false }, { accepted: true })).toEqual({ textOk: true, designOk: true });
    expect(llmWithOverride({ textOk: false, designOk: false }, { accepted: true })).toEqual({ textOk: false, designOk: true });
    expect(llmWithOverride({ textOk: true, designOk: false }, null)).toEqual({ textOk: true, designOk: false });
  });
  it('catatan audit memuat waktu, catatan owner, dan temuan QA yang diterima', () => {
    const d = makeTmp(); put(d, REJECT);
    const c = overrideComment(writeOverride(d, { note: 'oke', nowMs: Date.UTC(2026, 9, 16, 12, 0) }));
    expect(c).toContain('2026-10-16'); expect(c).toContain('oke'); expect(c).toContain('slide 4 layout');
  });
  it('penolakan QA tanpa returnTo/qaReturn tetap dikenali gerbang sebagai ditolak (override dinilai orkestrator, bukan checkQaResult)', () => {
    expect(checkQaResult(REJECT).ok).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
function require_read(p) { return readFileSync(p, 'utf8'); }
