import { describe, it, expect } from 'vitest';
import { isStatusQuestion, lastActivityFromLog, buildStatusText } from '../apps/office-view/status.mjs';

describe('isStatusQuestion', () => {
  it('pertanyaan progres singkat dikenali', () => {
    for (const t of ['lanjutkan progressnya setelah internet mati, sekarang sampai mana progressnya?', 'sampai mana?', 'status produksi gimana', 'sedang apa QA sekarang?', 'update dong']) expect(isStatusQuestion(t), t).toBe(true);
  });
  it('perintah, brief panjang, dan awalan manager: tidak dianggap pertanyaan status', () => {
    for (const t of ['buat carousel tentang AI Security', 'manager: sampai mana?', 'tulis ulang slide 2', 'x'.repeat(300) + ' status', 'halo', '']) expect(isStatusQuestion(t), t).toBe(false);
  });
});

describe('lastActivityFromLog', () => {
  const ev = (ts, part) => JSON.stringify({ ts, stream: 'stdout', chunk: JSON.stringify({ type: 'tool_use', part }) });
  it('mengambil aktivitas alat terakhir beserta argumennya', () => {
    const log = [ev('2026-10-09T08:20:50.000Z', { type: 'tool', tool: 'bash', state: { input: { command: 'Get-ChildItem x' } } }), ev('2026-10-09T08:20:59.000Z', { type: 'tool', tool: 'read', state: { input: { filePath: 'D:\\a\\research-raw.json' } } })].join('\n');
    expect(lastActivityFromLog(log)).toEqual({ ts: Date.parse('2026-10-09T08:20:59.000Z'), label: 'read D:\\a\\research-raw.json' });
  });
  it('log kosong/rusak -> null, tanpa melempar', () => {
    expect(lastActivityFromLog('')).toBeNull(); expect(lastActivityFromLog('bukan json\n{rusak')).toBeNull(); expect(lastActivityFromLog(undefined)).toBeNull();
  });
});

describe('buildStatusText', () => {
  const now = Date.parse('2026-10-09T08:30:00+07:00');
  const base = { nowMs: now, net: { offline: false }, agents: [{ name: 'QA', status: 'running', model: 'opencode/mimo-v2.6-flash-free' }, { name: 'Manager', status: 'idle' }, { name: 'Designer', status: 'idle' }], queue: 0, activity: { ts: now - 300_000, label: 'read research-raw.json' }, lastBlockLine: null };
  it('tahap berjalan: nomor tahap, yang selesai, aktivitas terakhir, internet, agent', () => {
    const t = buildStatusText({ ...base, job: { identifier: 'EDU-27', phase: 'running', stageIndex: 4, stageStartedMs: now - 12 * 60_000 } });
    expect(t).toContain('EDU-27 · tahap 5/5 QA'); expect(t).toContain('berjalan 12 menit');
    expect(t).toContain('Selesai: Manager (work order), Researcher, Verifier, Copywriter, Designer');
    expect(t).toContain('QA terakhir: read research-raw.json (5 menit lalu)');
    expect(t).toContain('Internet: online'); expect(t).toContain('QA running (mimo-v2.6-flash-free)'); expect(t).toContain('idle: Manager, Designer');
    expect(t).toContain('manager:');
  });
  it('offline, selesai, diblokir, dan tanpa produksi', () => {
    expect(buildStatusText({ ...base, net: { offline: true, since: now - 600_000 }, job: { identifier: 'EDU-27', phase: 'running', stageIndex: 1, stageStartedMs: now } })).toContain('TERPUTUS');
    expect(buildStatusText({ ...base, job: { identifier: 'EDU-27', phase: 'done', stageIndex: 4 } })).toContain('SELESAI');
    const b = buildStatusText({ ...base, job: { identifier: 'EDU-27', phase: 'blocked', stageIndex: 2 }, lastBlockLine: 'tahap Copywriter gagal: kuota' });
    expect(b).toContain('DIBLOKIR di tahap Copywriter'); expect(b).toContain('kuota');
    expect(buildStatusText({ ...base, job: null, queue: 2 })).toContain('Tidak ada produksi berjalan. Antrean brief: 2');
    expect(buildStatusText({ ...base, job: null, lastJob: { identifier: 'EDU-27', phase: 'done' } })).toContain('Produksi terakhir EDU-27 SELESAI');
  });
  it('perencanaan oleh Manager', () => {
    expect(buildStatusText({ ...base, job: { identifier: 'EDU-9', phase: 'planning', stageIndex: -1 } })).toContain('Manager sedang menyusun work order');
  });
});
