import { describe, it, expect } from 'vitest';
import { recoverStale, settleLedger } from '../scripts/autopost/worker.mjs';

const NOW = Date.UTC(2026, 9, 16, 12, 0);
describe('worker: pemulihan dan penyelesaian ledger', () => {
  it('sedang_diposting yang menggantung menjadi tidak_pasti (tidak pernah diulang); yang baru dibiarkan', () => {
    const old = { content: 'EDU-1', platform: 'instagram', mode: 'live', status: 'sedang_diposting', at: new Date(NOW - 30 * 60_000).toISOString() };
    const fresh = { ...old, content: 'EDU-2', at: new Date(NOW - 60_000).toISOString() };
    const r = recoverStale([old, fresh, { ...old, mode: 'dry-run' }], NOW);
    expect(r.recovered).toBe(1); expect(r.ledger[0].status).toBe('tidak_pasti'); expect(r.ledger[1].status).toBe('sedang_diposting'); expect(r.ledger[2].status).toBe('sedang_diposting');
  });
  it('settleLedger mengganti entri tulis-dulu dengan hasil akhir; gagal sebelum klik menambah entri', () => {
    const wa = { content: 'EDU-1', platform: 'instagram', mode: 'live', status: 'sedang_diposting', at: 'a' };
    const out = settleLedger([wa, { content: 'EDU-9', platform: 'instagram', mode: 'live', status: 'diposting', at: 'b' }], { content: 'EDU-1', platform: 'instagram', mode: 'live', status: 'diposting', at: 'c' });
    expect(out).toHaveLength(2); expect(out[0]).toMatchObject({ status: 'diposting', at: 'c' });
    const added = settleLedger([], { content: 'EDU-1', platform: 'instagram', mode: 'live', status: 'gagal', at: 'd' });
    expect(added).toEqual([{ content: 'EDU-1', platform: 'instagram', mode: 'live', status: 'gagal', at: 'd' }]);
  });
});
