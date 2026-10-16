import { describe, it, expect } from 'vitest';
import { shouldPrefetch, requestsSig, prefetchRunning, prefetchDoneFor } from '../scripts/asset-prefetch.mjs';

const base = { reqExists: true, mtimeMs: 100_000, stageStartedMs: 50_000, nowMs: 200_000, running: false, complete: false, lastSig: undefined, sig: 'a' };

describe('shouldPrefetch (ambil gambar dini)', () => {
  it('mulai bila berkas permintaan segar, stabil, dan belum dikerjakan', () => {
    expect(shouldPrefetch(base)).toBe(true);
  });
  it('tidak mulai: berkas belum ada, basi (sebelum tahap), masih ditulis, sedang berjalan, sudah lengkap, atau permintaan sama sudah dicoba', () => {
    expect(shouldPrefetch({ ...base, reqExists: false })).toBe(false);
    expect(shouldPrefetch({ ...base, mtimeMs: 10_000 })).toBe(false);
    expect(shouldPrefetch({ ...base, mtimeMs: 195_000 })).toBe(false);
    expect(shouldPrefetch({ ...base, running: true })).toBe(false);
    expect(shouldPrefetch({ ...base, complete: true })).toBe(false);
    expect(shouldPrefetch({ ...base, lastSig: 'a' })).toBe(false);
  });
  it('tanda tangan berubah bila isi permintaan atau inbox owner berubah', () => {
    expect(requestsSig('x', 's1')).toBe(requestsSig('x', 's1'));
    expect(requestsSig('x', 's1')).not.toBe(requestsSig('y', 's1'));
    expect(requestsSig('x', 's1')).not.toBe(requestsSig('x', 's2'));
  });
  it('keadaan awal: tidak ada capture berjalan dan tidak ada yang selesai', () => {
    expect(prefetchRunning()).toBe(false);
    expect(prefetchDoneFor('EDU-1', 'a')).toBe(false);
  });
});
