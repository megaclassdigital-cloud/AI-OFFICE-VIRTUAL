import { describe, it, expect } from 'vitest';
import { renderManagerContext, startOfDayWib, MAX_CONTEXT_CHARS } from '../scripts/manager-context.mjs';

const T = Date.parse('2026-10-09T17:30:00Z');

describe('renderManagerContext', () => {
  const base = {
    nowMs: T, active: { identifier: 'EDU-56', phase: 'running', stageName: 'QA' },
    pending: [{ identifier: 'EDU-58', ready: true, title: 'ChatGPT Astra dan Berita AGI' }],
    inbox: 1,
    recent: [{ code: 'EDU-49', label: 'EDU-49 · revisi 1', title: 'Anthropic perkuat keamanan AI dengan Cyber Mission' }],
    agents: [{ name: 'Researcher', model: 'nemotron', status: 'idle', runsToday: 3, cap: 30 }, { name: 'Designer', model: 'gemini', status: 'running', runsToday: 26, cap: 30 }],
    ownerNotes: ['Logo di slide 1 masih kurang bersih dan latarnya abu-abu'],
  };
  it('memuat antrean, konten terbaru, pemakaian, dan keluhan owner', () => {
    const t = renderManagerContext(base);
    expect(t).toMatch(/Berjalan: EDU-56 \(QA\)/); expect(t).toMatch(/Rencana siap: EDU-58 — ChatGPT Astra dan Berita AGI/); expect(t).toMatch(/inbox: 1/);
    expect(t).toMatch(/EDU-49 · revisi 1: Anthropic perkuat/); expect(t).toMatch(/Researcher: 3\/30 run/); expect(t).toMatch(/Keluhan owner terakhir/); expect(t).toMatch(/latarnya abu-abu/);
  });
  it('menandai agent yang hampir habis kuota hariannya', () => {
    const t = renderManagerContext(base);
    expect(t).toMatch(/Designer: 26\/30 run.*HAMPIR HABIS/); expect(t).not.toMatch(/Researcher: 3\/30 run.*HAMPIR HABIS/);
  });
  it('tanpa data: tetap rapi dan jujur ("belum ada"), rencana ditahan dan disusun dibedakan', () => {
    const t = renderManagerContext({ nowMs: T, pending: [{ identifier: 'A-1', hold: true }, { identifier: 'A-2' }] });
    expect(t).toMatch(/Tidak ada job berjalan/); expect(t).toMatch(/\(belum ada\)/); expect(t).toMatch(/Rencana ditahan: A-1/); expect(t).toMatch(/Rencana sedang disusun: A-2/);
    expect(t).not.toMatch(/Keluhan owner/);
  });
  it('dipotong bila terlalu panjang agar prompt Manager ringkas', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ code: `EDU-${i}`, title: 'x'.repeat(300) }));
    const t = renderManagerContext({ ...base, recent: many, ownerNotes: Array(5).fill('y'.repeat(400)), agents: Array.from({ length: 80 }, (_, i) => ({ name: 'A' + i, model: 'm', status: 'idle', runsToday: 0, cap: 30 })) });
    expect(t.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  });
  it('startOfDayWib: awal hari WIB (UTC+7)', () => {
    expect(new Date(startOfDayWib(Date.parse('2026-10-09T20:00:00Z'))).toISOString()).toBe('2026-10-09T17:00:00.000Z');
    expect(new Date(startOfDayWib(Date.parse('2026-10-09T10:00:00Z'))).toISOString()).toBe('2026-10-08T17:00:00.000Z');
  });
});

describe('konteks Manager memuat konten paralel', () => {
  it('menyebut konten yang berjalan di jalur paralel', () => {
    const t = renderManagerContext({ nowMs: T, active: { identifier: 'EDU-61', phase: 'running', stageName: 'Verifier' }, followers: [{ identifier: 'EDU-62', stageName: 'Researcher' }] });
    expect(t).toMatch(/Paralel: EDU-62 \(Researcher\)/);
  });
});
