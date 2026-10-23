import { describe, it, expect } from 'vitest';
import { supersededBlockedStage } from '../scripts/sustain-core.mjs';

describe('supersededBlockedStage: issue tahap lama yang diblokir tidak boleh menjebak agen di Pojok Bug', () => {
  const base = { title: 'EDU-124 · QA (10:07:58): Tren AI', status: 'blocked', id: 'qa-lama', liveStageIds: new Set(['designer-baru']), runningProds: new Set(['EDU-124']) };
  it('diblokir + produksinya sedang berjalan dengan issue tahap lain => digantikan (batalkan)', () => { expect(supersededBlockedStage(base)).toBe(true); });
  it('issue tahap yang SEDANG hidup tidak pernah dianggap digantikan', () => { expect(supersededBlockedStage({ ...base, id: 'designer-baru' })).toBe(false); });
  it('produksi tidak sedang berjalan (selesai/terblokir) => tidak disentuh aturan ini', () => { expect(supersededBlockedStage({ ...base, runningProds: new Set(['EDU-171']) })).toBe(false); expect(supersededBlockedStage({ ...base, runningProds: new Set() })).toBe(false); });
  it('hanya status blocked dan hanya judul issue tahap; masukan kosong aman', () => {
    expect(supersededBlockedStage({ ...base, status: 'in_review' })).toBe(false);
    expect(supersededBlockedStage({ ...base, title: 'Produksi: Konten otomatis' })).toBe(false);
    expect(supersededBlockedStage({ title: null, status: 'blocked', id: 'x' })).toBe(false);
  });
});
