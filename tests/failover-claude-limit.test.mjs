import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isFailoverError } from '../scripts/manager-failover.mjs';

describe('failover saat Claude Haiku kena limit', () => {
  it('pesan limit Claude dan kuota Gemini memicu pindah; galat tugas biasa tidak', () => {
    for (const t of ["You've hit your limit · resets 5pm (Asia/Jakarta)", '5-hour limit reached', 'Claude usage limit reached', 'You exceeded your current quota', 'Persistent ACP session could not be resumed: Authentication required']) expect(isFailoverError(t), t).toBe(true);
    for (const t of ['schema invalid: createdAt', 'Process lost -- child pid 1 is no longer running']) expect(isFailoverError(t), t).toBe(false);
  });
  it('rantai Copywriter: Haiku dahulu, lalu model gratis sebagai cadangan (tetap bisa bekerja bila Haiku limit)', () => {
    const cfg = JSON.parse(readFileSync(new URL('../divisions/edukasiai/agent-models.json', import.meta.url), 'utf8'));
    const ids = cfg.agents.Copywriter.map((e) => e.id);
    expect(ids[0]).toBe('haiku');
    expect(ids.length).toBeGreaterThanOrEqual(3); expect(ids).toContain('g35'); expect(ids).toContain('nemotron');
  });
});
