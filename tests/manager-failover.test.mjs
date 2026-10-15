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

import { pickEntry, returnTarget, blockDurationMs, isBlocked, pruneBlocked, HOUR_MS } from '../scripts/manager-failover.mjs';
describe('ChatGPT <-> Claude dua arah, pemicu hanya limit masing-masing', () => {
  const chain = [{ id: 'chatgpt', provider: 'chatgpt' }, { id: 'claude', provider: 'claude' }, { id: 'gemini' }];
  const excl = ['chatgpt', 'claude'];
  const T = 1_000_000;

  it('ChatGPT kena limit -> Claude mengambil alih; Claude kena limit (ChatGPT masih terblokir) -> Gemini', () => {
    expect(pickEntry({ chain, nowMs: T, exclude: 'chatgpt', blocked: { chatgpt: T + HOUR_MS } }).id).toBe('claude');
    expect(pickEntry({ chain, nowMs: T, exclude: 'claude', blocked: { chatgpt: T + HOUR_MS, claude: T + HOUR_MS } }).id).toBe('gemini');
  });
  it('sebaliknya: Claude kena limit saat ChatGPT sudah pulih -> ChatGPT mengambil alih', () => {
    expect(pickEntry({ chain, nowMs: T, exclude: 'claude', blocked: { claude: T + HOUR_MS } }).id).toBe('chatgpt');
  });
  it('semua habis -> null (butuh owner)', () => {
    expect(pickEntry({ chain: chain.slice(0, 2), nowMs: T, exclude: 'claude', blocked: { chatgpt: T + 1, claude: T + 1 } })).toBeNull();
  });
  it('blokir kedaluwarsa dihapus dan agent kembali ke prioritas yang lebih tinggi', () => {
    expect(isBlocked({ chatgpt: T + 5 }, 'chatgpt', T)).toBe(true);
    expect(isBlocked({ chatgpt: T - 1 }, 'chatgpt', T)).toBe(false);
    expect(pruneBlocked({ a: T - 1, b: T + 1 }, T)).toEqual({ b: T + 1 });
    expect(returnTarget({ chain, currentIdx: 1, blocked: { chatgpt: T - 1 }, nowMs: T })?.id).toBe('chatgpt');
    expect(returnTarget({ chain, currentIdx: 1, blocked: { chatgpt: T + 1 }, nowMs: T })).toBeNull();
    expect(returnTarget({ chain, currentIdx: 0, blocked: {}, nowMs: T })).toBeNull();
  });
  it('pengecualian bersama: penyedia eksklusif yang sedang dipakai agent lain mengunci pilihan ke penyedia itu', () => {
    expect(pickEntry({ chain, nowMs: T, activeProviders: ['claude'], exclusive: excl }).id).toBe('claude');
    expect(pickEntry({ chain, nowMs: T, activeProviders: ['chatgpt'], exclusive: excl }).id).toBe('chatgpt');
    // penyedia terkunci sedang diblokir -> tidak boleh melompat ke penyedia eksklusif lain, jatuh ke Gemini
    expect(pickEntry({ chain, nowMs: T, activeProviders: ['claude'], exclusive: excl, blocked: { claude: T + 1 } }).id).toBe('gemini');
  });
  it('lama blokir: login 12 jam, petunjuk waktu di pesan limit dipakai, selain itu 3 jam', () => {
    expect(blockDurationMs('Not logged in. Please login')).toBe(12 * HOUR_MS);
    expect(blockDurationMs('usage limit reached, try again in 2 hours')).toBe(2 * HOUR_MS + 60_000);
    expect(blockDurationMs('Rate limit. Retry in 30 minutes')).toBe(30 * 60_000 + 60_000);
    expect(blockDurationMs('429 too many requests, retry in 1 minute')).toBe(5 * 60_000 + 60_000);
    expect(blockDurationMs('quota exhausted')).toBe(3 * HOUR_MS);
  });
});

describe('konfigurasi rantai: Claude/ChatGPT hanya untuk Manager', () => {
  it('Manager ChatGPT > Claude > Gemini; agent lain tanpa penyedia eksklusif', async () => {
    const { readFileSync } = await import('node:fs');
    const cfg = JSON.parse(readFileSync(new URL('../divisions/edukasiai/agent-models.json', import.meta.url), 'utf8'));
    expect(cfg.exclusiveProviders).toEqual(['chatgpt', 'claude']);
    expect(cfg.agents.Manager.map((e) => e.id)).toEqual(['chatgpt', 'claude', 'claude-haiku', 'gemini']);
    for (const [name, chain] of Object.entries(cfg.agents)) {
      if (name === 'Manager') continue;
      for (const e of chain) expect(['chatgpt', 'claude'].includes(e.provider ?? e.id), `${name}/${e.id}`).toBe(false); // Haiku pakai provider claude-haiku (non-eksklusif)
    }
  });
});

describe('galat inisialisasi sesi (limit ChatGPT desktop) memicu pindah ke Claude', () => {
  it('Internal error dan acpx_session_init_failed dikenali; blokir mengikuti aturan limit', () => {
    expect(isFailoverError('Internal error acpx_session_init_failed')).toBe(true);
    expect(isFailoverError('ensure_session RequestError: Internal error')).toBe(true);
    expect(blockDurationMs('Internal error acpx_session_init_failed')).toBe(3 * HOUR_MS);
  });
});

describe('Haiku untuk peran penilaian (Researcher, Verifier, QA)', () => {
  it('Haiku 4.5 OAuth effort medium jadi prioritas utama, tidak eksklusif, dan tidak mengunci Manager', async () => {
    const { readFileSync } = await import('node:fs');
    const cfg = JSON.parse(readFileSync(new URL('../divisions/edukasiai/agent-models.json', import.meta.url), 'utf8'));
    for (const name of ['Researcher', 'Verifier', 'QA']) {
      const first = cfg.agents[name][0];
      expect(first, name).toMatchObject({ id: 'haiku', adapterType: 'claude_local', adapterConfig: { model: 'claude-haiku-4-5', effort: 'medium' } });
      expect(cfg.exclusiveProviders.includes(first.provider)).toBe(false);
      expect(cfg.agents[name].length).toBeGreaterThan(1); // cadangan gratis tetap ada
    }
    for (const name of ['Copywriter', 'Designer']) expect(cfg.agents[name].some((e) => e.id === 'haiku')).toBe(false);
  });
});
