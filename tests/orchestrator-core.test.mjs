import { describe, it, expect } from 'vitest';
import { STAGES, validateOrder, newJob, step, stageDescription, LIMITS, forwardSlashPaths, parseRevisionBrief, canPlanAhead, nextPlanned, activePending, MAX_PENDING_PLANS, laneOf, occupiedLanes, mustWaitForLane, canPromote, MAX_ACTIVE_JOBS, isManagerRetryable, normalizeOrderFileNames, findUnknownFileNames, CANONICAL_FILES, checkOrderStructure, extraContentsOf, analysisOf, renderAnalysisComment, MAX_EXTRA_CONTENTS } from '../scripts/orchestrator-core.mjs';

const goodOrder = { title: 'Carousel tren AI', stages: Object.fromEntries(STAGES.map((s) => [s, `kerjakan ${s}`])) };
const T0 = 1_000_000;
const job0 = () => newJob({ masterIssueId: 'm1', identifier: 'EDU-30', nowMs: T0 });

describe('validateOrder', () => {
  it('menerima work order lengkap', () => { expect(validateOrder(goodOrder)).toEqual({ ok: true, errors: [] }); });
  it('melaporkan semua masalah sekaligus', () => {
    const r = validateOrder({ title: '', stages: { researcher: 'x', hacker: 'y' } });
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining(['title wajib', 'stages.verifier wajib (teks instruksi)', 'stages.hacker bukan tahap yang dikenal']));
  });
  it('menolak bukan objek dan teks terlalu panjang', () => {
    expect(validateOrder(null).ok).toBe(false);
    expect(validateOrder({ ...goodOrder, stages: { ...goodOrder.stages, qa: 'x'.repeat(LIMITS.maxText + 1) } }).ok).toBe(false);
  });
});

describe('step: planning', () => {
  it('order valid -> mulai tahap 1', () => {
    const { job, actions } = step(job0(), { order: { ok: true, errors: [] }, managerFinished: true, nowMs: T0 + 5 });
    expect(job).toMatchObject({ phase: 'running', stageIndex: 0 });
    expect(actions.map((a) => a.type)).toEqual(['comment', 'createStage']);
    expect(actions[1].stage).toBe('researcher');
  });
  it('belum ada order dan Manager masih bekerja -> tunggu', () => {
    expect(step(job0(), { order: null, managerFinished: false, nowMs: T0 + 60_000 }).actions).toEqual([]);
  });
  it('Manager selesai tanpa order -> bangunkan ulang, lalu blok setelah batas percobaan', () => {
    let j = job0(); const facts = { order: null, managerFinished: true, nowMs: T0 + 1000 };
    for (let i = 0; i < LIMITS.maxPlanRetries; i++) { const r = step(j, facts); expect(r.actions[0].type).toBe('rewakeManager'); j = r.job; }
    const last = step(j, facts);
    expect(last.job.phase).toBe('blocked'); expect(last.actions[0].type).toBe('block');
  });
  it('order tidak valid -> bangunkan ulang membawa daftar galat', () => {
    const r = step(job0(), { order: { ok: false, errors: ['title wajib'] }, managerFinished: true, nowMs: T0 + 1 });
    expect(r.actions[0]).toMatchObject({ type: 'rewakeManager', errors: ['title wajib'] });
  });
  it('batas waktu perencanaan -> blok', () => {
    expect(step(job0(), { order: null, managerFinished: false, nowMs: T0 + LIMITS.planningTimeoutMs + 1 }).job.phase).toBe('blocked');
  });
});

describe('step: running', () => {
  const running = (i) => ({ ...job0(), phase: 'running', stageIndex: i, stageStartedMs: T0 });
  it('tahap selesai -> tahap berikutnya sesuai urutan', () => {
    for (let i = 0; i < STAGES.length - 1; i++) {
      const r = step(running(i), { stage: { status: 'in_review' }, nowMs: T0 + 10 });
      expect(r.job.stageIndex).toBe(i + 1);
      expect(r.actions[1]).toEqual({ type: 'createStage', stage: STAGES[i + 1] });
    }
  });
  it('tahap terakhir selesai -> finish, menunggu owner', () => {
    const r = step(running(STAGES.length - 1), { stage: { status: 'done' }, nowMs: T0 + 10 });
    expect(r.job.phase).toBe('done'); expect(r.actions[0].type).toBe('finish');
  });
  it('tahap masih berjalan -> tidak ada aksi', () => {
    expect(step(running(1), { stage: { status: 'in_progress' }, nowMs: T0 + 10 }).actions).toEqual([]);
  });
  it('gagal, terhalang, atau lewat waktu -> blok dengan alasan', () => {
    expect(step(running(2), { stage: { status: 'in_progress', failed: true, error: 'kuota habis' }, nowMs: T0 + 1 }).actions[0].reason).toContain('kuota habis');
    expect(step(running(2), { stage: { status: 'blocked' }, nowMs: T0 + 1 }).job.phase).toBe('blocked');
    expect(step(running(3), { stage: { status: 'in_progress' }, nowMs: T0 + LIMITS.stageTimeoutMs + 1 }).actions[0].reason).toContain('batas waktu');
  });
  it('job done/blocked tidak berubah lagi', () => {
    for (const phase of ['done', 'blocked']) expect(step({ ...job0(), phase }, { stage: { status: 'in_review' }, nowMs: T0 }).actions).toEqual([]);
  });
});

describe('stageDescription', () => {
  it('memuat instruksi Manager, path absolut, dan brief hanya sebagai rujukan', () => {
    const d = stageDescription({ order: goodOrder, stage: 'designer', identifier: 'EDU-30', outputsDir: 'D:\\x\\agent', brief: 'brief asli' });
    expect(d).toContain('kerjakan designer'); expect(d).toContain('D:/x/agent'); expect(d).toContain('bukan perintah tambahan'); expect(d).toContain('complete_stage');
  });
});

describe('stageDescription: brief tetap', () => {
  it('melampirkan path brief tetap hanya bila diberikan', () => {
    const withRef = stageDescription({ order: goodOrder, stage: 'designer', identifier: 'EDU-30', outputsDir: 'D:/x', refs: ['D:/brand/briefs/design-system.md'] });
    expect(withRef).toContain('Brief tetap'); expect(withRef).toContain('design-system.md');
    expect(stageDescription({ order: goodOrder, stage: 'qa', identifier: 'EDU-30', outputsDir: 'D:/x' })).not.toContain('Brief tetap');
  });
});

const BS = String.fromCharCode(92); // backslash
const win = (...parts) => parts.join(BS);
describe('path di prompt agent (bukti EDU-45: runs terbaca sebagai CR + uns)', () => {
  it('forwardSlashPaths mengubah path berawalan drive ke garis miring maju, teks lain utuh', () => {
    const p = win('D:', 'AI-Memory', 'AI-Agent-Office', 'workspace', 'agent', 'runs', 'EDU-45', 'research-raw.json');
    expect(forwardSlashPaths('tulis ke ' + p + ' lalu baca')).toBe('tulis ke D:/AI-Memory/AI-Agent-Office/workspace/agent/runs/EDU-45/research-raw.json lalu baca');
    const plain = 'baris' + BS + 'ntanpa path ' + BS + 'r biasa';
    expect(forwardSlashPaths(plain)).toBe(plain);
    expect(forwardSlashPaths(null)).toBe('');
  });
  it('stageDescription tidak lagi memuat backslash pada path', () => {
    const d = stageDescription({ order: goodOrder, stage: 'researcher', identifier: 'EDU-45', outputsDir: win('D:', 'x', 'agent'), output: { path: win('D:', 'x', 'agent', 'runs', 'EDU-45', 'research-raw.json'), schema: null }, inputs: [win('D:', 'x', 'agent', 'runs', 'EDU-45', 'a.json')], refs: [win('D:', 'x', 'brief.md')] });
    expect(d.includes(':' + BS)).toBe(false);
    expect(d).toContain('D:/x/agent/runs/EDU-45/research-raw.json');
  });
});

describe('parseRevisionBrief', () => {
  const brief = (meta, body = 'perbaiki desain slide 1') => `---
${meta}
---
${body}`;
  it('mengenali brief revisi dan mengembalikan sumber, tahap mulai, catatan', () => {
    const r = parseRevisionBrief(brief('mode: revisi\ndari: EDU-27\nmulai: designer'));
    expect(r).toMatchObject({ from: 'EDU-27', start: 'designer', startIndex: 3, notes: 'perbaiki desain slide 1' });
    expect(parseRevisionBrief(brief('mode: Revisi\ndari: EDU-5\nmulai: copywriter')).startIndex).toBe(2);
    expect(parseRevisionBrief(brief('mode: revisi\ndari: EDU-5')).start).toBe('designer');
  });
  it('bukan revisi bila tanpa front matter, mode lain, sumber tidak valid, atau tahap tidak diizinkan', () => {
    expect(parseRevisionBrief('# brief biasa')).toBeNull();
    expect(parseRevisionBrief(brief('mode: produksi\ndari: EDU-27'))).toBeNull();
    expect(parseRevisionBrief(brief('mode: revisi\ndari: ../../x'))).toBeNull();
    expect(parseRevisionBrief(brief('mode: revisi\ndari: EDU-27\nmulai: verifier'))).toBeNull();
    expect(parseRevisionBrief(brief('mode: revisi\ndari: EDU-27\nmulai: researcher'))).toMatchObject({ start: 'researcher', startIndex: 0 });
    expect(parseRevisionBrief(brief('mode: revisi\ndari: EDU-27\nmulai: qa'))).toBeNull();
    expect(parseRevisionBrief(null)).toBeNull();
  });
});

describe('perencanaan di muka (Manager responsif selagi job lain berjalan)', () => {
  const running = { identifier: 'EDU-56', phase: 'running', stageIndex: 3 };
  it('hanya selama ada job aktif dan slot rencana belum penuh', () => {
    expect(MAX_PENDING_PLANS).toBe(1);
    expect(canPlanAhead(running, [])).toBe(true);
    expect(canPlanAhead({ ...running, phase: 'planning' }, [])).toBe(true);
    expect(canPlanAhead(running, [{ identifier: 'EDU-58' }])).toBe(false);
    expect(canPlanAhead(null, [])).toBe(false);
    for (const phase of ['done', 'blocked']) expect(canPlanAhead({ ...running, phase }, [])).toBe(false);
  });
  it('nextPlanned: yang siap paling awal (FIFO); belum siap tidak dipromosikan', () => {
    expect(nextPlanned([])).toBeNull();
    expect(nextPlanned([{ identifier: 'a' }])).toBeNull();
    expect(nextPlanned([{ identifier: 'a' }, { identifier: 'b', ready: true }, { identifier: 'c', ready: true }]).identifier).toBe('b');
  });
});

describe('rencana yang ditahan owner (hold)', () => {
  it('tidak dipromosikan, tidak mengisi slot rencana, dan tidak menghalangi brief lain', () => {
    const running = { identifier: 'EDU-56', phase: 'running' };
    const held = { identifier: 'EDU-58', ready: true, hold: true };
    expect(nextPlanned([held])).toBeNull();
    expect(canPlanAhead(running, [held])).toBe(true);
    expect(activePending([held])).toEqual([]);
    expect(nextPlanned([held, { identifier: 'EDU-60', ready: true }]).identifier).toBe('EDU-60');
  });
});

describe('checkOrderStructure (template perintah Manager)', () => {
  const good = 'Tujuan: cari berita.\nMasukan: brief owner.\nBatasan: jangan karang.\nKeluaran: research-raw.json.\nSelesai bila: 5 kandidat.';
  const mk = (over = {}) => ({ title: 't', analysis: { topics: ['satu topik'] }, stages: { ...Object.fromEntries(STAGES.map((s) => [s, good])), ...over } });
  it('struktur lengkap lolos; 3 dari 4 label masih lolos', () => {
    expect(checkOrderStructure(mk())).toEqual({ ok: true, errors: [] });
    expect(checkOrderStructure(mk({ qa: 'Tujuan: a\nMasukan: b\nKeluaran: c' })).ok).toBe(true);
  });
  it('tanpa label ditolak dengan pesan yang menyebut tahap dan label kurang; huruf besar/kecil tidak masalah', () => {
    const r = checkOrderStructure(mk({ researcher: 'cari berita AI terbaru saja' }));
    expect(r.ok).toBe(false); expect(r.errors[0]).toMatch(/stages\.researcher harus berstruktur/); expect(r.errors[0]).toMatch(/Tujuan/);
    expect(checkOrderStructure(mk({ verifier: 'TUJUAN: a\nmasukan: b\nBATASAN: c' })).ok).toBe(true);
  });
  it('tahap Dilewati (revisi) tidak diperiksa', () => {
    expect(checkOrderStructure(mk({ researcher: 'Dilewati (revisi): memakai hasil EDU-49.', verifier: 'Dilewati (revisi): memakai hasil EDU-49.' })).ok).toBe(true);
  });
});

describe('Manager 2.0: analisis wajib, beberapa konten dari satu brief', () => {
  const good = 'Tujuan: a.\nMasukan: b.\nBatasan: c.\nKeluaran: d.';
  const stages = () => Object.fromEntries(STAGES.map((s) => [s, good]));
  const order = (over = {}) => ({ title: 'Konten A', analysis: { topics: ['ChatGPT Astra', 'Berita AGI'], assumptions: ['AGI = berita industri'], risks: ['produk mungkin tidak ada'], unknownEntities: ['ChatGPT Astra'] }, stages: stages(), ...over });

  it('analisis wajib: tanpa topik ditolak dengan petunjuk', () => {
    expect(checkOrderStructure(order()).ok).toBe(true);
    const r = checkOrderStructure(order({ analysis: undefined }));
    expect(r.ok).toBe(false); expect(r.errors.join()).toMatch(/analysis\.topics wajib/);
    expect(checkOrderStructure(order({ analysis: { topics: [] } })).ok).toBe(false);
    expect(checkOrderStructure(order({ analysis: { topics: ['x'] } })).ok).toBe(false);
  });
  it('konten tambahan: valid bila stages lengkap, maksimal 2, struktur ikut diperiksa', () => {
    const extra = { title: 'Berita AGI', stages: stages() };
    expect(validateOrder(order({ extraContents: [extra] })).ok).toBe(true);
    expect(extraContentsOf(order({ extraContents: [extra] }))).toEqual([{ title: 'Berita AGI', stages: extra.stages }]);
    expect(MAX_EXTRA_CONTENTS).toBe(2);
    const tooMany = validateOrder(order({ extraContents: [extra, extra, extra] }));
    expect(tooMany.ok).toBe(false); expect(tooMany.errors.join()).toMatch(/extraContents maksimal 2/);
    const bad = validateOrder(order({ extraContents: [{ title: 'ab', stages: { researcher: 'x' } }] }));
    expect(bad.ok).toBe(false); expect(bad.errors.join()).toMatch(/extraContents\[0\]\.title wajib/); expect(bad.errors.join()).toMatch(/extraContents\[0\]\.stages\.verifier wajib/);
    const unstructured = checkOrderStructure(order({ extraContents: [{ title: 'Berita AGI', stages: Object.fromEntries(STAGES.map((s) => [s, 'cari saja'])) }] }));
    expect(unstructured.ok).toBe(false); expect(unstructured.errors.join()).toMatch(/extraContents\[0\]\.stages\.researcher harus berstruktur/);
  });
  it('ownerQuestions dibatasi 3 teks pendek', () => {
    expect(validateOrder(order({ ownerQuestions: ['Apakah Astra produk resmi?'] })).ok).toBe(true);
    expect(validateOrder(order({ ownerQuestions: ['a', 'b', 'c', 'd'] })).ok).toBe(false);
    expect(validateOrder(order({ ownerQuestions: [123] })).ok).toBe(false);
  });
  it('komentar analisis memakai bahasa sederhana: topik, konten terpisah, nama tak dikenal, asumsi, pertanyaan', () => {
    const t = renderAnalysisComment(order({ extraContents: [{ title: 'Berita AGI', stages: stages() }], ownerQuestions: ['Apakah Astra produk resmi?'] }));
    expect(t).toMatch(/Rencana Manager siap: "Konten A"/); expect(t).toMatch(/ChatGPT Astra; Berita AGI/);
    expect(t).toMatch(/2 konten terpisah.*"Berita AGI".*kode konten berbeda/); expect(t).toMatch(/tidak saya kenal.*ChatGPT Astra/);
    expect(t).toMatch(/Asumsi: AGI = berita industri/); expect(t).toMatch(/Pertanyaan untuk Anda.*Astra produk resmi/);
    expect(analysisOf({}).topics).toEqual([]);
  });
});

describe('slot perencanaan Manager: rencana siap tidak memakai slot', () => {
  it('canPlanAhead menghitung hanya rencana yang belum siap dan tidak ditahan', () => {
    const running = { identifier: 'EDU-56', phase: 'running' };
    expect(canPlanAhead(running, [{ identifier: 'a', ready: true }])).toBe(true);
    expect(canPlanAhead(running, [{ identifier: 'a', ready: true }, { identifier: 'b', ready: true, hold: true }])).toBe(true);
    expect(canPlanAhead(running, [{ identifier: 'a' }])).toBe(false);
  });
});

describe('isManagerRetryable (galat Manager yang pulih sendiri tidak memblokir perencanaan)', () => {
  it('limit, login, dan gagal inisialisasi sesi dianggap bisa pulih', () => {
    for (const t of ['Internal error', 'acpx_session_init_failed', 'usage limit reached', 'You exhausted your daily quota', '429 Too Many Requests', 'Not logged in', 'ensure_session failed']) expect(isManagerRetryable(t), t).toBe(true);
  });
  it('galat tugas biasa tidak', () => {
    for (const t of ['schema validation failed', 'JSON tidak bisa dibaca', '', null]) expect(isManagerRetryable(t), String(t)).toBe(false);
  });
});

describe('nama berkas baku di work order (kasus EDU-61: verify-result.json, carousel-copy.json)', () => {
  const good = 'Tujuan: a.\nMasukan: b.\nBatasan: c.\nKeluaran: d.';
  const order = (stages = {}, extra = {}) => ({ title: 't', analysis: { topics: ['satu topik'] }, stages: { ...Object.fromEntries(STAGES.map((s) => [s, good])), ...stages }, ...extra });

  it('alias umum diperbaiki ke nama baku di semua tahap dan konten tambahan, tanpa menyentuh nama baku', () => {
    const o = order({ verifier: 'Keluaran: verify-result.json lalu baca research-output.json.', copywriter: 'Masukan: verify-result.json dan carousel-copy.json.' },
      { extraContents: [{ title: 'Konten dua', stages: { ...Object.fromEntries(STAGES.map((s) => [s, good])), qa: 'Keluaran: qa-report.json' } }] });
    const r = normalizeOrderFileNames(o);
    expect(r.changed).toBe(true);
    expect(r.order.stages.verifier).toBe('Keluaran: verification-result.json lalu baca research-output.json.');
    expect(r.order.stages.copywriter).toBe('Masukan: verification-result.json dan carousel.json.');
    expect(r.order.extraContents[0].stages.qa).toBe('Keluaran: qa-result.json');
    expect(r.replaced.map((x) => x.from).sort()).toEqual(['carousel-copy.json', 'qa-report.json', 'verify-result.json']);
    expect(o.stages.verifier).toMatch(/verify-result/); // masukan asli tidak diubah
  });
  it('nama yang mengandung alias sebagai potongan tidak diubah', () => {
    const r = normalizeOrderFileNames(order({ designer: 'tulis my-design.json dan carousel-design.json' }));
    expect(r.order.stages.designer).toBe('tulis my-design.json dan carousel-design.json');
    expect(r.changed).toBe(false);
  });
  it('nama karangan (bukan baku, bukan konfigurasi) ditolak dengan daftar nama baku', () => {
    expect(findUnknownFileNames(order({ qa: 'Keluaran: laporan-akhir.json' }))).toEqual(['laporan-akhir.json']);
    const r = checkOrderStructure(order({ qa: 'Tujuan: a.\nMasukan: b.\nBatasan: c.\nKeluaran: laporan-akhir.json' }));
    expect(r.ok).toBe(false); expect(r.errors.join()).toMatch(/laporan-akhir\.json/); expect(r.errors.join()).toMatch(/verification-result\.json/);
  });
  it('nama baku, konfigurasi dikenal, dan berkas order EDU-n.json tidak dianggap karangan', () => {
    const t = 'Masukan: carousel.json, asset-requests.json, templates.json, brand.json, D:/x/orders/EDU-61.json';
    expect(findUnknownFileNames(order({ designer: t }))).toEqual([]);
    expect(CANONICAL_FILES).toContain('verification-result.json');
  });
});

describe('jalur perakitan: banyak konten, satu agent satu konten', () => {
  const run = (stageIndex, over = {}) => ({ identifier: 'EDU-' + stageIndex, phase: 'running', stageIndex, stageIssueId: 'i' + stageIndex, ...over });
  it('laneOf: planning = jalur 0; running = tahapnya sampai selesai; laneWait/done/blocked = tidak memegang jalur', () => {
    expect(laneOf({ phase: 'planning' })).toBe(0);
    expect(laneOf(run(2))).toBe(2);
    expect(laneOf(run(2, { laneWait: true }))).toBeNull();
    expect(laneOf(run(2, { stageIssueId: null }))).toBeNull();
    for (const phase of ['done', 'blocked']) expect(laneOf(run(1, { phase }))).toBeNull();
    expect(laneOf(null)).toBeNull();
  });
  it('mustWaitForLane: maju ke jalur yang dipegang job di depan harus menunggu; jalur bebas atau tahap yang sama tidak', () => {
    const occupied = occupiedLanes([run(1)]);
    expect([...occupied]).toEqual([1]);
    expect(mustWaitForLane(run(0), run(1), occupied)).toBe(true);
    expect(mustWaitForLane(run(0), run(1), new Set())).toBe(false);
    expect(mustWaitForLane(run(1), run(1), occupied)).toBe(false); // tahap sama (percobaan ulang), bukan maju
    expect(mustWaitForLane(run(4), { phase: 'done', stageIndex: 4 }, occupied)).toBe(false); // selesai bukan jalur baru
  });
  it('skenario perakitan: Researcher langsung mengambil konten kedua begitu konten pertama pindah ke Verifier', () => {
    // t0: A di Researcher (jalur 0). B belum boleh dipromosikan.
    let A = run(0); let B = null;
    expect(canPromote([A])).toBe(false);
    // t1: A selesai Researcher dan pindah ke Verifier (jalur 0 dilepas): B dipromosikan.
    A = run(1);
    expect(canPromote([A])).toBe(true);
    B = { identifier: 'EDU-B', phase: 'planning' };
    expect(canPromote([A, B])).toBe(false); // B memegang jalur 0 sejak promosi
    // t2: B (jalur 0) selesai dan ingin ke Verifier, tetapi A masih di Verifier -> menunggu
    B = run(0, { identifier: 'EDU-B' });
    const next = run(1, { identifier: 'EDU-B' });
    expect(mustWaitForLane(B, next, occupiedLanes([A]))).toBe(true);
    B = { ...B, laneWait: true }; // B menunggu; jalur 0 bebas lagi
    expect(canPromote([A, B])).toBe(true);
    // t3: A pindah ke Copywriter (jalur 2); jalur 1 bebas, B boleh maju
    A = run(2);
    expect(mustWaitForLane(B, next, occupiedLanes([A]))).toBe(false);
  });
  it('batas konten aktif', () => {
    expect(MAX_ACTIVE_JOBS).toBe(3);
    expect(canPromote([run(1), run(2), run(3)])).toBe(false);
    expect(canPromote([run(1), run(2)])).toBe(true);
    expect(canPromote([run(1), { phase: 'done' }, { phase: 'blocked' }])).toBe(true);
  });
});

import { summarizeVerification, researchFeedbackText } from '../scripts/orchestrator-core.mjs';
describe('Verifier -> kembali ke Researcher bila terlalu sedikit yang valid', () => {
  const vr = (statuses) => ({ results: statuses.map((s, i) => ({ candidateId: `c0${i + 1}`, url: `https://x.test/${i}`, status: s, reason: s === 'verified' ? undefined : 'HTTP 403' })) });
  const atVerifier = (extra = {}) => ({ ...job0(), phase: 'running', stageIndex: 1, stageStartedMs: T0, ...extra });
  it('summarizeVerification: hitungan, alasan penolakan, minVerified dari order atau default', () => {
    const v = summarizeVerification(vr(['verified', 'rejected', 'rejected']), null);
    expect(v).toMatchObject({ total: 3, verified: 1, minVerified: LIMITS.minVerified });
    expect(v.rejected[0].reason).toBe('HTTP 403');
    expect(summarizeVerification(vr(['verified']), { minVerified: 1 }).minVerified).toBe(1);
    expect(summarizeVerification(vr(['verified']), { minVerified: 99 }).minVerified).toBe(LIMITS.minVerified);
  });
  it('terverifikasi cukup -> lanjut ke Copywriter seperti biasa', () => {
    const v = summarizeVerification(vr(['verified', 'verified', 'verified', 'rejected']), null);
    const r = step(atVerifier(), { stage: { status: 'in_review' }, verification: v, nowMs: T0 + 10 });
    expect(r.job.stageIndex).toBe(2); expect(r.actions.at(-1)).toEqual({ type: 'createStage', stage: 'copywriter' });
  });
  it('terlalu sedikit -> kembali ke Researcher dengan umpan balik, putaran dihitung', () => {
    const v = summarizeVerification(vr(['verified', 'rejected', 'rejected', 'rejected']), null);
    const r = step(atVerifier(), { stage: { status: 'in_review' }, verification: v, nowMs: T0 + 10 });
    expect(r.job.stageIndex).toBe(0); expect(r.job.researchLoops).toBe(1); expect(r.job.phase).toBe('running');
    const act = r.actions.at(-1);
    expect(act).toMatchObject({ type: 'createStage', stage: 'researcher' });
    expect(act.feedback).toContain('HTTP 403'); expect(act.feedback).toContain('https://x.test/0'); // yang valid dipertahankan, yang ditolak disebut
  });
  it('batas putaran tercapai: lanjut bila ada >=1 valid, blok bila nol', () => {
    const some = summarizeVerification(vr(['verified', 'rejected', 'rejected']), null);
    const r1 = step(atVerifier({ researchLoops: LIMITS.maxResearchLoops }), { stage: { status: 'in_review' }, verification: some, nowMs: T0 + 10 });
    expect(r1.job.stageIndex).toBe(2); expect(r1.actions.some((a) => a.type === 'comment' && /Batas putaran/.test(a.text))).toBe(true);
    const none = summarizeVerification(vr(['rejected', 'rejected']), null);
    const r2 = step(atVerifier({ researchLoops: LIMITS.maxResearchLoops }), { stage: { status: 'in_review' }, verification: none, nowMs: T0 + 10 });
    expect(r2.job.phase).toBe('blocked');
  });
  it('tanpa data verifikasi (mis. tahap lain) perilaku lama tidak berubah', () => {
    expect(step(atVerifier({ stageIndex: 2 }), { stage: { status: 'in_review' }, nowMs: T0 + 10 }).job.stageIndex).toBe(3);
  });
});

import { checkQaResult, qaFeedbackText } from '../scripts/orchestrator-core.mjs';
describe('QA meminta revisi langsung ke departemen', () => {
  it('passed=false dengan returnTo/llmReview -> qaReturn ke departemen hulu; tanpa petunjuk tetap fatal', () => {
    expect(checkQaResult({ passed: false, returnTo: ['designer', 'researcher'], notes: ['x'] }).qaReturn.to).toBe('researcher');
    expect(checkQaResult({ passed: false, llmReview: { textOk: false, designOk: true }, notes: ['teks'] }).qaReturn.to).toBe('copywriter');
    expect(checkQaResult({ passed: false, llmReview: { textOk: true, designOk: false }, notes: ['desain'] }).qaReturn.to).toBe('designer');
    expect(checkQaResult({ passed: false, notes: ['?'] }).fatal).toBe(true);
    expect(checkQaResult({ passed: true, llmReview: { textOk: true, designOk: true }, designReview: { layout: true, photo: true, font: true } }).ok).toBe(true);
  });
  it('umpan balik QA menyebut departemen dan catatan', () => {
    const t = qaFeedbackText(['slide 3 salah'], 'designer', 1);
    expect(t).toContain('Designer'); expect(t).toContain('slide 3 salah');
  });
});

describe('QA: penilaian desain wajib dan "buat dari awal"', () => {
  const ok = { textOk: true, designOk: true };
  it('passed=true wajib designReview lengkap dan tanpa false', () => {
    expect(checkQaResult({ passed: true, llmReview: ok }).ok).toBe(false);
    expect(checkQaResult({ passed: true, llmReview: ok, designReview: { layout: true, photo: true } }).ok).toBe(false);
    expect(checkQaResult({ passed: true, llmReview: ok, designReview: { layout: true, photo: false, font: true } }).ok).toBe(false);
    expect(checkQaResult({ passed: true, llmReview: ok, designReview: { layout: true, photo: true, font: true } }).ok).toBe(true);
  });
  it('designReview false tanpa returnTo -> Designer; fromScratch -> Researcher dengan scratch', () => {
    const r = checkQaResult({ passed: false, llmReview: ok, designReview: { layout: true, photo: false, font: true }, notes: ['foto buram'] });
    expect(r.qaReturn.to).toBe('designer');
    const s = checkQaResult({ passed: false, fromScratch: true, returnTo: ['designer'], notes: ['isi tidak valid'] });
    expect(s.qaReturn.to).toBe('researcher'); expect(s.qaReturn.scratch).toBe(true);
    expect(qaFeedbackText(['x'], 'researcher', 1, true)).toContain('DARI AWAL');
  });
});

import { sanitizeVerification } from '../scripts/orchestrator-core.mjs';
describe('sanitizeVerification (hemat putaran agen)', () => {
  it('membuang properti tak dikenal dan null, mengisi urlReachable.ok, tanpa mengubah fakta', () => {
    const r = sanitizeVerification({ verifiedAt: 'x', windowDays: 7, results: [{ candidateId: 'c1', checks: { urlReachable: { ok: null, httpStatus: null, finalUrl: null } } }], topicStatus: 'ok' });
    expect(Object.keys(r.data).sort()).toEqual(['results', 'verifiedAt', 'windowDays']);
    expect(r.data.results[0].checks.urlReachable.ok).toBe(false);
    expect(r.data.results[0].checks.urlReachable.httpStatus).toBeUndefined();
    expect(r.changes.length).toBeGreaterThan(0);
  });
  it('data yang sudah rapi tidak berubah', () => {
    const d = { verifiedAt: 'x', windowDays: 7, results: [{ checks: { urlReachable: { ok: true, httpStatus: 200 } } }] };
    const r = sanitizeVerification(d);
    expect(r.changes).toEqual([]); expect(r.data).toEqual(d);
  });
});

describe('QA menandai issue blocked setelah vonis penolakan', () => {
  const runningQa = () => ({ ...newJob({ masterIssueId: 'm', identifier: 'EDU-9', nowMs: 1_000 }), phase: 'running', stageIndex: STAGES.indexOf('qa'), stageStartedMs: 1_000, stageAttempts: 1, stageIssueId: 'i' });
  const qaReturn = { to: 'designer', departments: ['designer'], notes: ['slide 2-7 tanpa visual'], scratch: false };
  it('dengan qaReturn: dirutekan ke Designer (putaran 1), bukan diblokir', () => {
    const r = step(runningQa(), { stage: { status: 'blocked' }, output: { ok: false, qaReturn, errors: ['QA menolak'] }, nowMs: 60_000 });
    expect(r.job.phase).toBe('running'); expect(r.job.qaLoops).toBe(1); expect(r.job.stageIndex).toBe(STAGES.indexOf('designer'));
    expect(r.actions.find((a) => a.type === 'createStage')).toMatchObject({ stage: 'designer' });
  });
  it('tanpa vonis yang bisa dirutekan: tetap diblokir; jatah putaran habis: diblokir', () => {
    expect(step(runningQa(), { stage: { status: 'blocked' }, output: null, nowMs: 60_000 }).job.phase).toBe('blocked');
    expect(step({ ...runningQa(), qaLoops: LIMITS.maxQaLoops }, { stage: { status: 'blocked' }, output: { ok: false, qaReturn, errors: ['x'] }, nowMs: 60_000 }).job.phase).toBe('blocked');
  });
  it('tahap selain QA yang blocked tidak terpengaruh', () => {
    const j = { ...runningQa(), stageIndex: STAGES.indexOf('designer') };
    expect(step(j, { stage: { status: 'blocked' }, output: { ok: false, qaReturn, errors: ['x'] }, nowMs: 60_000 }).job.phase).toBe('blocked');
  });
});

describe('sanitizeVerification: kandidat ditolak tanpa kolom cek wajib dilengkapi (tidak pernah untuk yang verified)', () => {
  it('rejected: urlReachable/dateWithinWindow yang hilang diisi ok:false; verified dibiarkan apa adanya', () => {
    const data = { verifiedAt: '2026-10-17T00:00:00Z', windowDays: 7, results: [
      { candidateId: 'c01', url: 'https://a.example', status: 'rejected', reason: 'x', checks: { dateWithinWindow: { ok: false } } },
      { candidateId: 'c02', url: 'https://b.example', status: 'verified', checks: { dateWithinWindow: { ok: true } } },
    ] };
    const { data: out, changes } = sanitizeVerification(data);
    expect(out.results[0].checks.urlReachable).toEqual({ ok: false, error: 'tidak diperiksa oleh Verifier' });
    expect(out.results[1].checks.urlReachable).toBeUndefined(); // verified wajib hasil tool: tetap ditolak skema
    expect(changes.join()).toMatch(/kandidat ditolak c01/);
  });
});
