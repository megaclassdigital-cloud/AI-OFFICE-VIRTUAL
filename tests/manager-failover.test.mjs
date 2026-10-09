import { describe, it, expect } from 'vitest';
import { isFailoverError, nextIndex, shouldReset, dayKey } from '../scripts/manager-failover.mjs';

describe('manager failover', () => {
  it('mengganti model hanya untuk kuota/auth, bukan galat tugas biasa', () => {
    for (const t of ['You exhausted your daily quota on this model', '429 Too Many Requests', 'Authentication required', 'usage limit reached', 'not logged in']) expect(isFailoverError(t)).toBe(true);
    for (const t of ['Process exited with code 1', 'timeout after 600s', 'schema validation failed', '', null]) expect(isFailoverError(t)).toBe(false);
  });
  it('urutan ChatGPT -> Gemini -> Claude lalu habis', () => {
    expect(nextIndex(3, 0)).toBe(1); expect(nextIndex(3, 1)).toBe(2); expect(nextIndex(3, 2)).toBeNull();
  });
  it('hari baru (WIB) mengembalikan ke prioritas utama, hari yang sama tidak', () => {
    const d1 = Date.parse('2026-10-09T10:00:00Z'); const d1b = Date.parse('2026-10-09T16:00:00Z'); const d2 = Date.parse('2026-10-09T18:00:00Z');
    expect(dayKey(d1)).toBe('2026-10-09'); expect(dayKey(d2)).toBe('2026-10-10');
    expect(shouldReset({ currentIdx: 1, lastSwitchMs: d1, nowMs: d1b })).toBe(false);
    expect(shouldReset({ currentIdx: 1, lastSwitchMs: d1, nowMs: d2 })).toBe(true);
    expect(shouldReset({ currentIdx: 0, lastSwitchMs: d1, nowMs: d2 })).toBe(false);
  });
});

import { isBusy, lockHeld } from '../scripts/manager-failover.mjs';
describe('satu model aktif, tanpa bentrok', () => {
  it('sibuk bila ada run queued/running', () => {
    expect(isBusy([{ status: 'succeeded' }, { status: 'running' }])).toBe(true);
    expect(isBusy([{ status: 'queued' }])).toBe(true);
    expect(isBusy([{ status: 'succeeded' }, { status: 'failed' }, { status: 'cancelled' }])).toBe(false);
    expect(isBusy([])).toBe(false);
  });
  it('kunci watcher: pid lain yang hidup menahan, pid mati/tidak valid/diri sendiri tidak', () => {
    expect(lockHeld(4242, () => true)).toBe(true);
    expect(lockHeld(4242, () => false)).toBe(false);
    expect(lockHeld(NaN, () => true)).toBe(false);
    expect(lockHeld(process.pid, () => true)).toBe(false);
  });
});

describe('galat model/ACP juga memicu pindah', () => {
  it('terminal service failure dan model tidak tersedia', () => {
    expect(isFailoverError('ACP agent reported a terminal service failure.')).toBe(true);
    expect(isFailoverError('acpx_turn_failed')).toBe(true);
    expect(isFailoverError('The model gpt-5.4 is not available for this account')).toBe(true);
  });
});

describe('galat jaringan BUKAN alasan pindah model', () => {
  it('Cannot connect to API / socket ditutup tidak memicu failover', () => {
    expect(isFailoverError('Cannot connect to API: Unable to connect. Is the computer able to access the url?')).toBe(false);
    expect(isFailoverError('Cannot connect to API: The socket connection was closed unexpectedly.')).toBe(false);
  });
});
