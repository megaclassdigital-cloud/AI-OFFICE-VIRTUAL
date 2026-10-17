import { describe, it, expect } from 'vitest';
import { summarizeProduction, productionStatus, stageStates, applyLive } from '../apps/office-view/production.mjs';

const research = { windowDays: 7, candidates: [{ id: 'c01', title: 'Anthropic Cyber Mission', source_name: 'Anthropic', published_at: '2026-10-08', summary: 'Ringkasan satu', url: 'https://a.test/1' }, { id: 'c02', title: 'Gemini agen', source_name: 'TechCrunch', published_at: '2026-10-07', summary: 'Ringkasan dua', url: 'https://a.test/2', non_whitelist: true }] };
const verification = { results: [{ candidateId: 'c01', url: 'https://a.test/1', status: 'verified', checks: { urlReachable: { ok: true }, dateWithinWindow: { ok: true, publishedAt: '2026-10-08' }, claimFound: { ok: true } } }, { candidateId: 'c02', url: 'https://a.test/2', status: 'rejected', reason: 'URL 403', checks: { urlReachable: { ok: false } } }] };
const carousel = { topic: 'Tren AI', angle: 'sudut', caption: 'caption', hashtags: ['#ai'], sources: [{ candidateId: 'c01', url: 'https://a.test/1', source_name: 'Anthropic' }], slides: [{ index: 1, role: 'hook', heading: 'Judul', body: 'Isi', emphasis: ['Judul'], sourceRefs: ['c01', 'c02'] }, { index: 2, role: 'cta', heading: 'Ikuti', body: 'x' }] };
const design = { slides: [{ index: 1, template: 'cover', colorVariant: 'teknologi', icon: 'spark', emphasis: ['Judul'] }, { index: 2, template: 'cta', colorVariant: 'teknologi' }] };
const render = ['runs/EDU-9/render/slide-02.png', 'runs/EDU-9/render/slide-01.png', 'runs/EDU-9/render/contact-sheet.png', 'runs/EDU-9/render/visual-qa.json'];

describe('productionStatus', () => {
  it('menunggu approval = in_review + handoff; disetujui = done; revisi = in_progress setelah handoff', () => {
    expect(productionStatus({ master: { status: 'in_review' }, hasHandoff: true }).key).toBe('menunggu_approval');
    expect(productionStatus({ master: { status: 'done' }, hasHandoff: true }).key).toBe('disetujui');
    expect(productionStatus({ master: { status: 'in_progress' }, hasHandoff: true }).key).toBe('perlu_revisi');
  });
  it('job aktif menang; terblokir; tanpa apa pun = draf', () => {
    expect(productionStatus({ master: { status: 'in_review' }, hasHandoff: true, job: { phase: 'running' } }).key).toBe('berjalan');
    expect(productionStatus({ job: { phase: 'blocked' } }).key).toBe('terblokir');
    expect(productionStatus({}).key).toBe('draf');
  });
});

describe('stageStates', () => {
  it('berdasarkan artefak yang ada; job berjalan menandai tahap kini', () => {
    const have = { order: true, research: true, verification: true, carousel: false, design: false, render: false, qa: false };
    const s = stageStates({ have, job: { phase: 'running', stageIndex: 2 } });
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'done', 'running', 'pending', 'pending']);
  });
});

describe('summarizeProduction (bahasa hasil kerja, bukan log)', () => {
  const sum = summarizeProduction({ prod: 'EDU-9', order: { title: 'Carousel tren AI', stages: { researcher: 'cari', qa: 'periksa' } }, research, verification, carousel, design, qa: { passed: false, llmReview: { textOk: true, designOk: true }, deterministicObserved: { slideCount: 2, pngCount: 2, canvas: '1080x1350', allSlidesPassed: true, minFontPx: 28, minContrast: 4.5 }, notes: ['catatan 1'] }, master: { id: 'm1', identifier: 'EDU-9', status: 'in_review' }, handoff: { contentHash: 'abc' }, renderFiles: render });
  it('judul, status, slide terurut, contact sheet, caption, sumber', () => {
    expect(sum.title).toBe('Carousel tren AI'); expect(sum.status).toMatchObject({ key: 'menunggu_approval', label: 'MENUNGGU APPROVAL' });
    expect(sum.slides.map((s) => s.image)).toEqual(['runs/EDU-9/render/slide-01.png', 'runs/EDU-9/render/slide-02.png']);
    expect(sum.contactSheet).toContain('contact-sheet.png'); expect(sum.caption).toBe('caption'); expect(sum.sources[0]).toMatchObject({ name: 'Anthropic', title: 'Anthropic Cyber Mission' });
  });
  it('Researcher: kandidat dengan sumber, tanggal, dan penanda di luar whitelist', () => {
    expect(sum.research.count).toBe(2); expect(sum.research.items[1]).toMatchObject({ source: 'TechCrunch', offWhitelist: true });
  });
  it('Verifier: hitung terverifikasi dan jelaskan cek dalam kalimat', () => {
    expect(sum.verification).toMatchObject({ verified: 1, total: 2 });
    expect(sum.verification.items[0].notes).toEqual(['URL terjangkau', 'terbit 2026-10-08 (dalam jendela)', 'klaim ditemukan di halaman']);
    expect(sum.verification.items[1]).toMatchObject({ ok: false, reason: 'URL 403' });
  });
  it('Copywriter: peran berlabel Indonesia dan sumber per slide diterjemahkan ke nama media', () => {
    expect(sum.copy.slides[0]).toMatchObject({ roleLabel: 'Pembuka', heading: 'Judul', sources: ['Anthropic', 'TechCrunch'] }); expect(sum.copy.slides[1].roleLabel).toBe('Ajakan');
  });
  it('Designer: template, varian ramah, gambar render per slide', () => {
    expect(sum.design.variants).toEqual(['Teknologi (cyan)']); expect(sum.design.slides[0]).toMatchObject({ template: 'Sampul', icon: 'spark', image: 'runs/EDU-9/render/slide-01.png' });
  });
  it('QA: vonis resmi dari handoff plugin; cek dan catatan agen sebagai konteks', () => {
    expect(sum.qa.official).toMatchObject({ passed: true, contentHash: 'abc' }); expect(sum.qa.agentPassed).toBe(false);
    expect(sum.qa.checks.map((c) => c.ok)).toEqual([true, true, true, true, true, true, true]); expect(sum.qa.notes).toEqual(['catatan 1']);
  });
  it('Manager: rencana per agen; artefak kosong tidak melempar', () => {
    expect(sum.manager.plans).toEqual([{ agent: 'Researcher', instruction: 'cari' }, { agent: 'QA', instruction: 'periksa' }]);
    const empty = summarizeProduction({ prod: 'EDU-1' });
    expect(empty).toMatchObject({ research: null, verification: null, copy: null, design: null, qa: null, manager: null, slides: [] });
  });
});

import { cleanTitle } from '../apps/office-view/production.mjs';
describe('penyempurnaan TV', () => {
  it('cleanTitle membuang awalan teknis dan stempel waktu', () => {
    expect(cleanTitle('Produksi: Carousel tren AI (10-09 05:35)')).toBe('Carousel tren AI');
    expect(cleanTitle('Carousel tanpa awalan')).toBe('Carousel tanpa awalan'); expect(cleanTitle(null)).toBe('');
  });
  it('status jujur saat Paperclip tidak terjangkau, kecuali job aktif', () => {
    expect(productionStatus({ unknown: true }).key).toBe('tidak_diketahui');
    expect(productionStatus({ unknown: true, job: { phase: 'running' } }).key).toBe('berjalan');
  });
  it('stats dan waktu selesai per tahap dari artefak', () => {
    const s = summarizeProduction({ prod: 'EDU-9', research: { windowDays: 7, candidates: [{ id: 'c01', title: 't', source_name: 's', published_at: '2026-10-08', summary: 'x', url: 'https://a.test' }] }, verification: { results: [{ candidateId: 'c01', url: 'https://a.test', status: 'verified', checks: {} }] }, carousel: { topic: 'T', slides: [], sources: [{ candidateId: 'c01', url: 'u', source_name: 's' }] }, handoff: { contentHash: 'h' }, master: { id: 'm', status: 'in_review' }, mtimes: { researcher: 1000, verifier: 2000 }, renderFiles: [] });
    expect(s.stats).toMatchObject({ candidates: 1, verified: 1, sources: 1, qa: 'lolos' });
    expect(s.stages.find((x) => x.key === 'researcher')).toMatchObject({ state: 'done', doneAt: 1000 });
    expect(s.stages.find((x) => x.key === 'designer').doneAt).toBeNull();
    expect(s.paperclipOk).toBe(true); expect(summarizeProduction({ prod: 'EDU-9', paperclipOk: false }).status.key).toBe('tidak_diketahui');
  });
});

describe('status LIVE dari posted.json (Admin Publikasi)', () => {
  const base = { key: 'disetujui', label: 'DISETUJUI', tone: 'ok' };
  it('diposting di platform mana pun => LIVE dengan daftar platform; status lama dicatat di prior', () => {
    const s = applyLive(base, { instagram: { status: 'diposting' }, tiktok: { status: 'diposting' } });
    expect([s.key, s.label, s.tone, s.platforms, s.prior]).toEqual(['live', 'LIVE', 'live', ['Instagram', 'TikTok'], 'disetujui']);
  });
  it('hanya satu platform diposting, satu tidak pasti => tetap LIVE dan menandai yang tidak pasti', () => {
    const s = applyLive(base, { instagram: { status: 'diposting' }, tiktok: { status: 'tidak_pasti' } });
    expect([s.key, s.platforms, s.unsure]).toEqual(['live', ['Instagram'], ['TikTok']]);
  });
  it('hanya tidak pasti => peringatan; tanpa catatan atau gagal => status produksi tidak berubah', () => {
    expect(applyLive(base, { tiktok: { status: 'tidak_pasti' } }).key).toBe('tidak_pasti');
    expect(applyLive(base, null)).toBe(base);
    expect(applyLive(base, { tiktok: { status: 'gagal' } })).toBe(base);
  });
});
