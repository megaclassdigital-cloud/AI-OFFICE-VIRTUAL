import { describe, it, expect } from 'vitest';
import { makeAway, awayExpired, inWarmup, WARMUP_MS } from '../scripts/away-core.mjs';

describe('mode pergi', () => {
  it('tanpa jam = tanpa batas; dengan jam = batas waktu; masukan aneh tidak merusak', () => {
    expect(makeAway({ nowMs: 1000 }).until).toBeNull();
    expect(makeAway({ nowMs: 1000, hours: 0 }).until).toBeNull();
    expect(makeAway({ nowMs: 1000, hours: 'abc' }).until).toBeNull();
    expect(makeAway({ nowMs: 0, hours: 8 }).until).toBe(8 * 3_600_000);
    expect(makeAway({ nowMs: 0, hours: 0.5 }).until).toBe(1_800_000);
    expect(makeAway({ nowMs: 0, note: 'x'.repeat(500) }).note).toHaveLength(200);
  });
  it('awayExpired: hanya bila ada batas dan sudah lewat', () => {
    expect(awayExpired(null, 5)).toBe(false);
    expect(awayExpired({ since: 0, until: null }, 1e15)).toBe(false);
    expect(awayExpired({ since: 0, until: 100 }, 99)).toBe(false);
    expect(awayExpired({ since: 0, until: 100 }, 100)).toBe(true);
  });
  it('pemanasan setelah boot: kantor otonom menunggu WARMUP_MS', () => {
    expect(inWarmup(0, WARMUP_MS - 1)).toBe(true);
    expect(inWarmup(0, WARMUP_MS)).toBe(false);
  });
});
