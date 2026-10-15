import { describe, it, expect } from 'vitest';
import { keywordRoute, validateRouting, makeRequest, resolveRouting, buildRevisionBrief, managerRoutingRequestText, UNDO_WINDOW_MS, MANAGER_WAIT_MS } from '../scripts/revision-router.mjs';
import { parseRevisionBrief } from '../scripts/orchestrator-core.mjs';

const T0 = 1_000_000;
const req = (extra = {}) => ({ ...makeRequest({ identifier: 'EDU-49', issueId: 'i1', reason: 'logo kurang jelas', nowMs: T0 }), ...extra });

describe('keywordRoute (cadangan bila Manager tidak menjawab)', () => {
  it('visual saja -> designer; teks -> copywriter; keduanya -> tahap paling awal (copywriter)', () => {
    expect(keywordRoute('logo di slide 1 buram dan warna terlalu gelap')).toMatchObject({ startStage: 'designer', escalate: false });
    expect(keywordRoute('kalimat slide 3 terlalu teknis')).toMatchObject({ startStage: 'copywriter', escalate: false });
    expect(keywordRoute('kalimat terlalu teknis dan warna kurang bagus')).toMatchObject({ startStage: 'copywriter' });
  });
  it('masalah fakta/sumber ditandai escalate (riset tidak diulang di mode revisi)', () => {
    expect(keywordRoute('angka di slide 2 salah, sumbernya tidak benar')).toMatchObject({ startStage: 'copywriter', escalate: true });
  });
});

describe('validateRouting (Manager hanya mengusulkan; kode memvalidasi)', () => {
  it('menerima keputusan sah', () => {
    const r = validateRouting({ startStage: 'designer', summary: 'hanya logo yang salah', instructions: { designer: 'cari logo resmi yang lebih bersih' } });
    expect(r.ok).toBe(true); expect(r.value.startStage).toBe('designer');
  });
  it('menolak tahap yang tidak sah, kolom asing, dan arahan ke tahap yang tidak dijalankan', () => {
    expect(validateRouting({ startStage: 'verifier', summary: 'riset ulang' }).ok).toBe(false);
    expect(validateRouting({ startStage: 'researcher', summary: 'isi tidak valid, riset ulang' }).ok).toBe(true);
    expect(validateRouting({ startStage: 'qa', summary: 'langsung qa' }).ok).toBe(false);
    expect(validateRouting({ startStage: 'designer', summary: 'ok ya', assignTo: 'Verifier' }).errors.join()).toMatch(/assignTo/);
    expect(validateRouting({ startStage: 'designer', summary: 'ok ya', instructions: { copywriter: 'ubah teks' } }).errors.join()).toMatch(/sebelum startStage/);
    expect(validateRouting({ startStage: 'designer', summary: 'ok ya', instructions: { verifier: 'cek' } }).errors.join()).toMatch(/bukan tahap revisi/);
  });
  it('menolak summary kosong, teks terlalu panjang, dan bukan objek', () => {
    expect(validateRouting({ startStage: 'copywriter', summary: '' }).ok).toBe(false);
    expect(validateRouting({ startStage: 'copywriter', summary: 'ok ya', instructions: { copywriter: 'x'.repeat(1501) } }).ok).toBe(false);
    for (const bad of [null, 'teks', [], 7]) expect(validateRouting(bad).ok).toBe(false);
  });
});

describe('resolveRouting (jendela batal, pilihan owner, Manager, cadangan)', () => {
  it('menunggu selama jendela batal 60 detik; batal menang', () => {
    expect(resolveRouting({ request: req(), manager: null, nowMs: T0 + UNDO_WINDOW_MS - 1 })).toEqual({ action: 'wait' });
    expect(resolveRouting({ request: req(), manager: null, cancelled: true, nowMs: T0 })).toEqual({ action: 'cancel' });
  });
  it('tahap pilihan owner mengalahkan Manager', () => {
    const r = resolveRouting({ request: req({ forceStage: 'designer' }), manager: { startStage: 'copywriter', summary: 'teks salah' }, nowMs: T0 + UNDO_WINDOW_MS });
    expect(r).toMatchObject({ action: 'create', start: 'designer', source: 'owner' });
  });
  it('keputusan Manager yang valid dipakai; yang tidak valid dialihkan ke kata kunci', () => {
    const ok = resolveRouting({ request: req(), manager: { startStage: 'designer', summary: 'logo saja', instructions: { designer: 'logo bersih' } }, nowMs: T0 + UNDO_WINDOW_MS });
    expect(ok).toMatchObject({ action: 'create', start: 'designer', source: 'manager' });
    const bad = resolveRouting({ request: req(), manager: { startStage: 'verifier', summary: 'cek ulang' }, nowMs: T0 + UNDO_WINDOW_MS });
    expect(bad).toMatchObject({ action: 'create', start: 'designer', source: 'kata-kunci', note: 'manager-tidak-valid' });
  });
  it('Manager belum menjawab: tunggu, lalu cadangan kata kunci setelah batas waktu', () => {
    expect(resolveRouting({ request: req(), manager: null, nowMs: T0 + UNDO_WINDOW_MS + 1 })).toEqual({ action: 'wait' });
    expect(resolveRouting({ request: req(), manager: null, nowMs: T0 + MANAGER_WAIT_MS })).toMatchObject({ action: 'create', source: 'kata-kunci', note: 'manager-tidak-menjawab' });
  });
  it('makeRequest menolak tahap tujuan yang tidak sah', () => {
    expect(() => makeRequest({ identifier: 'EDU-1', issueId: 'i', reason: 'x', forceStage: 'verifier', nowMs: T0 })).toThrow(/tahap tujuan/);
  });
});

describe('buildRevisionBrief dan teks untuk Manager', () => {
  it('brief revisi dapat dibaca parseRevisionBrief dan memuat alasan + arahan', () => {
    const md = buildRevisionBrief({ from: 'EDU-49', start: 'designer', reason: 'logo buram', summary: 'hanya visual', instructions: { designer: 'logo resmi bersih' }, source: 'manager' });
    expect(parseRevisionBrief(md)).toMatchObject({ from: 'EDU-49', start: 'designer', startIndex: 3 });
    expect(md).toContain('logo buram'); expect(md).toContain('Arahan Manager untuk designer');
  });
  it('permintaan ke Manager memakai path garis miring maju', () => {
    const BS = String.fromCharCode(92);
    const t = managerRoutingRequestText({ identifier: 'EDU-49', reason: 'logo buram', file: ['D:', 'x', 'routing', 'EDU-49.json'].join(BS) });
    expect(t).toContain('D:/x/routing/EDU-49.json'); expect(t.includes(':' + BS)).toBe(false); expect(t).toContain('logo buram');
  });
});

describe('revisi riset (isi/referensi tidak valid)', () => {
  it('kata kunci "tidak valid"/"referensi" mengarah ke researcher; fakta ketik biasa tetap copywriter', () => {
    expect(keywordRoute('Isi kontennya tidak valid. Ambil referensi dari pembahasan ChatGPT Astra')).toMatchObject({ startStage: 'researcher', escalate: false });
    expect(keywordRoute('cari sumber lain, topiknya salah')).toMatchObject({ startStage: 'researcher' });
    expect(keywordRoute('angka di slide 2 salah, sumbernya tidak benar')).toMatchObject({ startStage: 'copywriter', escalate: true });
  });
});
