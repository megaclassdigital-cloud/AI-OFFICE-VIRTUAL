import { describe, it, expect } from 'vitest';
import { llmFromQaResult, verificationTargets } from '../scripts/finalize-production.mjs';

describe('llmFromQaResult: penilaian QA tidak pernah dikarang', () => {
  it('memakai llmReview milik QA', () => {
    expect(llmFromQaResult({ passed: true, llmReview: { textOk: true, designOk: false } })).toEqual({ textOk: true, designOk: false });
  });
  it('tanpa llmReview dan tanpa override sadar -> null (harus ditolak)', () => {
    expect(llmFromQaResult({ passed: true })).toBeNull(); expect(llmFromQaResult(null)).toBeNull();
    expect(llmFromQaResult({ passed: true }, { textOk: true })).toBeNull();
  });
  it('override hanya bila KEDUANYA diberikan eksplisit', () => {
    expect(llmFromQaResult({ passed: true }, { textOk: true, designOk: true })).toEqual({ textOk: true, designOk: true });
  });
});

describe('verificationTargets', () => {
  const research = { candidates: [{ id: 'c01', published_at: '2026-10-08' }, { id: 'c02', published_at: '2026-10-07' }] };
  it('hanya kandidat verified; tanggal dari research-output, cadangan dari cek verifikasi', () => {
    const v = { results: [
      { candidateId: 'c01', url: 'https://a.test/1', status: 'verified', checks: {} },
      { candidateId: 'c02', url: 'https://a.test/2', status: 'rejected', checks: {} },
      { candidateId: 'c09', url: 'https://a.test/9', status: 'verified', checks: { dateWithinWindow: { publishedAt: '2026-10-06' } } },
    ] };
    expect(verificationTargets(v, research)).toEqual([
      { candidateId: 'c01', url: 'https://a.test/1', published_at: '2026-10-08' },
      { candidateId: 'c09', url: 'https://a.test/9', published_at: '2026-10-06' },
    ]);
  });
  it('input kosong aman', () => { expect(verificationTargets(null, null)).toEqual([]); });
});
