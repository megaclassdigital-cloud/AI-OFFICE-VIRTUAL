import { describe, it, expect } from 'vitest';
import { isStatusQuestion, lastActivityFromLog, buildStatusText, isResearchQuestion, buildResearchText, buildBriefAck } from '../apps/office-view/status.mjs';

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

describe('isResearchQuestion / buildResearchText', () => {
  it('mengenali pertanyaan hasil riset (termasuk pesan owner yang memicu bug EDU-44)', () => {
    const q = 'saya mau tanya dulu, researcher sudah mencari berita" tentang AI, untuk yang sudah ditemukan sekarang itu untuk 1 konten atau untuk beberapa konten yang siap dibuatkan konsep nya oleh copywriter?';
    expect(isResearchQuestion(q)).toBe(true);
    expect(isStatusQuestion(q)).toBe(false);
    expect(isResearchQuestion('berapa kandidat berita yang ditemukan riset?')).toBe(true);
  });
  it('bukan perintah dan bukan status', () => {
    for (const t of ['buat carousel tentang riset AI', 'sampai mana?', 'halo', '', 'manager: berapa kandidat?']) expect(isResearchQuestion(t), t).toBe(false);
  });
  it('jawaban dari berkas: jumlah kandidat, terverifikasi, satu carousel per produksi', () => {
    const a = buildResearchText({ identifier: 'EDU-27', research: { candidates: [{ id: 'c01', title: 'A' }, { id: 'c02', title: 'B' }] }, verification: { results: [{ candidateId: 'c01', status: 'verified' }, { candidateId: 'c02', status: 'rejected' }] }, carousel: { topic: 'Topik X panjang', slides: [1, 2, 3, 4, 5, 6], sources: [1] } });
    expect(a).toMatch(/EDU-27/); expect(a).toMatch(/2 kandidat/); expect(a).toMatch(/1 lolos verifikasi/); expect(a).toMatch(/SATU carousel/); expect(a).toMatch(/c01: A \[verified\]/); expect(a).toMatch(/6 slide/);
  });
  it('tanpa data riset: jujur, tidak mengarang', () => {
    expect(buildResearchText({})).toMatch(/Belum ada hasil riset/);
  });
});

describe('buildBriefAck (balasan instan saat brief masuk antrean)', () => {
  const job = { identifier: 'EDU-56', phase: 'running', stageIndex: 3 };
  it('tanpa job berjalan: segera diambil', () => {
    expect(buildBriefAck({})).toMatch(/Tidak ada job berjalan.*Manager langsung menyusun rencana/);
  });
  it('job berjalan, antrean kosong: Manager merencanakan paralel dan job tidak diganggu', () => {
    const t = buildBriefAck({ job });
    expect(t).toMatch(/antrean #1/); expect(t).toMatch(/EDU-56 \(tahap Designer\) tetap berjalan dan tidak diganggu/); expect(t).toMatch(/Manager mulai menyusun rencana brief ini sekarang, paralel/);
  });
  it('slot rencana terpakai: posisi bertambah dan dijelaskan menunggu slot', () => {
    const t = buildBriefAck({ job, pending: [{ identifier: 'EDU-58', ready: false }], inboxAhead: 1 });
    expect(t).toMatch(/antrean #3/); expect(t).toMatch(/EDU-58/); expect(t).toMatch(/slot rencana kosong/);
  });
  it('job selesai/diblokir dianggap tidak berjalan', () => {
    expect(buildBriefAck({ job: { ...job, phase: 'done' } })).toMatch(/Tidak ada job berjalan/);
  });
  it('status memuat rencana yang disusun/siap', () => {
    const f = { nowMs: 1_000_000, job: { identifier: 'EDU-56', phase: 'running', stageIndex: 3, stageStartedMs: 900_000 }, agents: [], net: null, activity: null, queue: 0, pending: [{ identifier: 'EDU-58', ready: false }] };
    expect(buildStatusText(f)).toMatch(/EDU-58: Manager sedang menyusun rencana/);
    f.pending = [{ identifier: 'EDU-58', ready: true }];
    expect(buildStatusText(f)).toMatch(/EDU-58: rencana Manager siap, menunggu giliran/);
  });
});
