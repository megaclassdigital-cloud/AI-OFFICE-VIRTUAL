import { describe, it, expect } from 'vitest';
import { classifyOwnerReply, choosePlan, decidePlanAction, planReplyText } from '../scripts/owner-reply.mjs';
import { appendOutbox, readOutbox, readAllOutbox, buildPlanMessage, speakerName } from '../scripts/manager-outbox.mjs';
import { STAGES } from '../scripts/orchestrator-core.mjs';
import { makeTmp } from './helpers.mjs';

describe('classifyOwnerReply', () => {
  it('persetujuan eksplisit; gabungan dengan jawaban menjadi approve + catatan', () => {
    for (const t of ['setuju', 'Setuju!', 'lanjutkan', 'ok', 'oke gas', 'mulai', 'approve', 'silakan']) expect(classifyOwnerReply(t).intent, t).toBe('approve');
    expect(classifyOwnerReply('setuju, maksudnya produk resmi OpenAI')).toEqual({ intent: 'approve', note: 'maksudnya produk resmi OpenAI' });
    expect(classifyOwnerReply('setuju').note).toBe('');
  });
  it('pembatalan eksplisit', () => {
    for (const t of ['batal', 'Batalkan', 'tolak', 'jangan lanjut', 'stop']) expect(classifyOwnerReply(t).intent, t).toBe('cancel');
  });
  it('kata yang BUKAN persetujuan: "ya" saja, kata di tengah kalimat, dan teks bebas', () => {
    expect(classifyOwnerReply('ya produk OpenAI').intent).toBe('text');
    expect(classifyOwnerReply('menurut saya jangan lanjut ke AGI dulu').intent).toBe('text');
    expect(classifyOwnerReply('okelah nanti dulu').intent).toBe('text'); // "okelah" bukan "oke"
    expect(classifyOwnerReply('').intent).toBe('none');
    expect(classifyOwnerReply(null).intent).toBe('none');
  });
});

describe('decidePlanAction', () => {
  const plans = [{ identifier: 'EDU-61', readyMs: 100 }, { identifier: 'EDU-63', readyMs: 200 }];
  it('tanpa rencana yang ditahan: bukan urusan rencana (chat biasa)', () => {
    expect(decidePlanAction({ text: 'setuju', plans: [] })).toBeNull();
  });
  it('memilih rencana yang disebut kodenya, selain itu yang paling baru siap, dan menyebut yang lain', () => {
    expect(decidePlanAction({ text: 'setuju EDU-61', plans })).toMatchObject({ action: 'approve', identifier: 'EDU-61', others: ['EDU-63'] });
    expect(decidePlanAction({ text: 'setuju', plans })).toMatchObject({ action: 'approve', identifier: 'EDU-63', others: ['EDU-61'] });
    expect(choosePlan(plans, 'batal edu-61').identifier).toBe('EDU-61');
  });
  it('teks bebas = jawaban hanya bila ada pertanyaan, bukan pertanyaan, dan pendek', () => {
    const q = (id) => id === 'EDU-61';
    expect(decidePlanAction({ text: 'produk resmi OpenAI', plans: [plans[0]], hasQuestions: q })).toMatchObject({ action: 'note', note: 'produk resmi OpenAI' });
    expect(decidePlanAction({ text: 'produk resmi OpenAI', plans: [plans[0]], hasQuestions: () => false })).toBeNull();
    expect(decidePlanAction({ text: 'apakah ini produk resmi?', plans: [plans[0]], hasQuestions: q })).toBeNull();
    expect(decidePlanAction({ text: 'x'.repeat(401), plans: [plans[0]], hasQuestions: q })).toBeNull();
  });
  it('teks balasan: persetujuan, pembatalan, catatan, dan rencana lain disebut', () => {
    expect(planReplyText({ action: 'approve', identifier: 'EDU-61', note: 'x' })).toMatch(/disetujui dengan catatan Anda/);
    expect(planReplyText({ action: 'cancel', identifier: 'EDU-61' })).toMatch(/dibatalkan.*Tidak ada kuota/);
    expect(planReplyText({ action: 'note', identifier: 'EDU-61', others: ['EDU-63'] })).toMatch(/dicatat.*EDU-63/);
  });
});

describe('kotak keluar Manager', () => {
  it('id naik, pembukaan pertama hanya 10 terakhir, setelahnya hanya yang baru; baris rusak dilewati', () => {
    const dir = makeTmp('aao-outbox-');
    for (let i = 1; i <= 12; i++) appendOutbox(dir, { text: 'pesan ' + i }, i * 1000);
    const all = readAllOutbox(dir);
    expect(all.map((m) => m.id)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(readOutbox(dir, 0).map((m) => m.id)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(readOutbox(dir, 10).map((m) => m.text)).toEqual(['pesan 11', 'pesan 12']);
    expect(readOutbox(dir, 12)).toEqual([]);
    expect(all[0]).toMatchObject({ from: 'Manager', at: 1000 });
  });
  it('direktori kosong aman', () => { expect(readOutbox(makeTmp('aao-outbox2-'), 0)).toEqual([]); });
  it('pesan rencana memuat analisis, pertanyaan, ringkasan Manager, dan cara membalas', () => {
    const stage = 'Tujuan: a.\nMasukan: b.\nBatasan: c.\nKeluaran: d.';
    const order = { title: 'Mengenal Astra', analysis: { topics: ['Astra', 'AGI'], unknownEntities: ['Chat GPT Astra'] }, ownerQuestions: ['Produk OpenAI atau Google?'], stages: Object.fromEntries(STAGES.map((s) => [s, stage])), extraContents: [{ title: 'Berita AGI', stages: Object.fromEntries(STAGES.map((s) => [s, stage])) }] };
    const m = buildPlanMessage({ identifier: 'EDU-61', order, managerSummary: 'Dua topik; Astra dicek dulu.', needsApproval: true, from: 'Manager (Claude)' });
    expect(m).toMatchObject({ kind: 'plan', identifier: 'EDU-61', from: 'Manager (Claude)', needsApproval: true });
    expect(m.text).toMatch(/^\[EDU-61\] Rencana Manager siap/); expect(m.text).toMatch(/Chat GPT Astra/); expect(m.text).toMatch(/Produk OpenAI atau Google\?/);
    expect(m.text).toMatch(/Ringkasan Manager: Dua topik/); expect(m.text).toMatch(/"setuju" untuk memulai.*"batal"/);
    expect(buildPlanMessage({ identifier: 'EDU-61', order }).text).toMatch(/langsung berjalan/);
  });
  it('nama pembicara menyebut model', () => {
    expect(speakerName('claude_local')).toBe('Manager (Claude)'); expect(speakerName('codex_local')).toBe('Manager (ChatGPT)'); expect(speakerName('lain')).toBe('Manager');
  });
});

import { classifyControl } from '../scripts/owner-reply.mjs';
import { buildStatusText } from '../apps/office-view/status.mjs';
describe('jeda dan lanjut pekerjaan', () => {
  it('perintah kendali khusus; tidak bentrok dengan persetujuan rencana', () => {
    for (const t of ['jeda', 'Jeda dulu', 'pause', 'istirahat', 'hentikan sementara']) expect(classifyControl(t), t).toBe('pause');
    for (const t of ['kerja lagi', 'lanjut kerja', 'resume']) expect(classifyControl(t), t).toBe('resume');
    for (const t of ['setuju', 'lanjutkan', 'batal', 'sampai mana?', 'jedanya dicabut?']) expect(classifyControl(t), t).toBeNull();
  });
  it('status menyebut jeda dan agent yang masih bekerja (aman menutup bila kosong)', () => {
    const base = { nowMs: 1_000_000, job: null, agents: [{ name: 'Designer', status: 'running', model: 'x' }, { name: 'QA', status: 'idle', model: 'y' }], net: null, activity: null, queue: 0, paused: true };
    expect(buildStatusText(base)).toMatch(/DIJEDA owner.*Agent yang masih menyelesaikan run: Designer.*kerja lagi/);
    expect(buildStatusText({ ...base, agents: [{ name: 'QA', status: 'idle', model: 'y' }] })).toMatch(/aman menutup aplikasi/);
    expect(buildStatusText({ ...base, paused: false })).not.toMatch(/DIJEDA/);
  });
});
