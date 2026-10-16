// production.mjs — turns the raw artifacts of one production into human-readable per-division views for the TV dashboard.
// Pure (no I/O, no LLM): the same files always give the same summary. Nothing here is invented; every line comes from an artifact.

export const STAGE_ORDER = [
  { key: 'manager', agent: 'Manager', label: 'Perencanaan' },
  { key: 'researcher', agent: 'Researcher', label: 'Riset berita' },
  { key: 'verifier', agent: 'Verifier', label: 'Verifikasi sumber' },
  { key: 'copywriter', agent: 'Copywriter', label: 'Penulisan' },
  { key: 'designer', agent: 'Designer', label: 'Desain' },
  { key: 'qa', agent: 'QA', label: 'Pemeriksaan mutu' },
];
const ROLE = { hook: 'Pembuka', point: 'Poin', stat: 'Angka', quote: 'Kutipan', comparison: 'Perbandingan', cta: 'Ajakan' };
const TEMPLATE = { cover: 'Sampul', point: 'Poin', stat: 'Angka besar', quote: 'Kutipan', comparison: 'Perbandingan', cta: 'Ajakan' };
const VARIANT = { editorial: 'Editorial (kuning)', risiko: 'Risiko (merah)', teknologi: 'Teknologi (cyan)', default: 'Lama: default', tegas: 'Lama: tegas', terang: 'Lama: terang' };

const STATUS = {
  menunggu_approval: { label: 'MENUNGGU APPROVAL', tone: 'warn' },
  disetujui: { label: 'DISETUJUI', tone: 'ok' },
  dibatalkan: { label: 'DIBATALKAN / SUDAH DITOLAK', tone: 'mut' },
  perlu_revisi: { label: 'PERLU REVISI', tone: 'bad' },
  berjalan: { label: 'SEDANG DIPRODUKSI', tone: 'run' },
  menunggu_aset: { label: 'MENUNGGU GAMBAR ASLI', tone: 'warn' },
  terblokir: { label: 'TERBLOKIR', tone: 'bad' },
  draf: { label: 'DRAF', tone: 'mut' },
  tidak_diketahui: { label: 'STATUS TIDAK DIKETAHUI', tone: 'mut' },
};

/** "Produksi: Carousel ..." -> "Carousel ..." (awalan teknis tidak berguna di layar). */
export const cleanTitle = (t) => String(t ?? '').replace(/^Produksi:\s*/i, '').replace(/^(Revisi\s+)+/i, 'Revisi ').replace(/\s*\([0-9]{2}-[0-9]{2} [0-9:]{4,5}\)\s*$/, '').trim();

/** Pure: production status from the master issue, the handoff document and the orchestrator job. */
export function productionStatus({ master, hasHandoff, job, unknown = false, holdCount = 0 }) {
  if (unknown && !(job?.phase)) return { key: 'tidak_diketahui', ...STATUS.tidak_diketahui };
  let key = 'draf';
  if (job && job.phase === 'running' || job?.phase === 'planning') key = 'berjalan';
  else if (job?.phase === 'blocked') key = 'terblokir';
  if (key === 'berjalan' && holdCount > 0) key = 'menunggu_aset'; // Designer selesai, produksi ditahan menunggu gambar asli (bukan "sedang bekerja")
  else if (master?.status === 'done') key = 'disetujui';
  else if (master?.status === 'in_review' && hasHandoff) key = 'menunggu_approval';
  else if (master?.status === 'in_progress' && hasHandoff) key = 'perlu_revisi';
  else if (master?.status === 'cancelled') key = 'dibatalkan'; // sudah ditolak/diganti: tidak ada keputusan yang bisa diambil lagi
  else if (hasHandoff && !master) key = 'menunggu_approval';
  return { key, ...STATUS[key] };
}

/** Pure: state of each stage from the artifacts that exist (and the job, when it is the active one). */
export function stageStates({ have, job, mtimes = {}, holdCount = 0 }) {
  const order = ['manager', 'researcher', 'verifier', 'copywriter', 'designer', 'qa'];
  const doneByFile = { manager: have.order, researcher: have.research, verifier: have.verification, copywriter: have.carousel, designer: have.design && have.render, qa: have.qa };
  return STAGE_ORDER.map((s, i) => {
    let state = doneByFile[s.key] ? 'done' : 'pending';
    if (job && ['running', 'planning'].includes(job.phase)) {
      const cur = job.phase === 'planning' ? 0 : job.stageIndex + 1;
      if (i === cur) state = 'running';
    }
    if (state === 'running' && s.key === 'designer' && holdCount > 0) state = 'hold';
    if (job?.phase === 'blocked' && i === (job.stageIndex >= 0 ? job.stageIndex + 1 : 0)) state = 'blocked';
    return { ...s, state, index: order.indexOf(s.key), doneAt: state === 'done' ? (mtimes[s.key] ?? null) : null };
  });
}

const verdictText = (c) => {
  const parts = [];
  if (c?.urlReachable) parts.push(c.urlReachable.ok ? 'URL terjangkau' : 'URL tidak terjangkau');
  if (c?.dateWithinWindow) parts.push(c.dateWithinWindow.ok ? `terbit ${c.dateWithinWindow.publishedAt ?? ''} (dalam jendela)`.trim() : 'di luar jendela tanggal');
  if (c?.claimFound) parts.push(c.claimFound.ok ? 'klaim ditemukan di halaman' : 'klaim tidak ditemukan');
  return parts;
};

export function summarizeProduction({ prod, order, research, verification, carousel, design, qa, visualQa, master, handoff, job, renderFiles = [], mtimes = {}, paperclipOk = true, hold = null, fallbackSlides = null, qaHistory = [] }) {
  const have = { order: !!order, research: !!research, verification: !!verification, carousel: !!carousel, design: !!design, render: renderFiles.some((f) => /slide-01\.png$/.test(f)), qa: !!qa };
  const slidePngs = renderFiles.filter((f) => /slide-[0-9]+\.png$/.test(f)).sort();
  const contact = renderFiles.find((f) => /contact-sheet\.png$/.test(f)) ?? null;
  const titleOf = new Map((research?.candidates ?? []).map((c) => [c.id, c]));
  const holdCount = hold?.missing?.length ?? 0;
  const status = productionStatus({ master, hasHandoff: !!handoff, job: job?.identifier === prod ? job : null, unknown: !paperclipOk, holdCount });

  const designBy = new Map((design?.slides ?? []).map((s) => [s.index, s]));
  const verified = (verification?.results ?? []).filter((r) => r.status === 'verified').length;

  // QA: the official verdict is the plugin handoff (deterministic, sealed); the agent's own file is shown as context.
  const det = qa?.deterministic ?? qa?.deterministicObserved ?? null;
  const qaChecks = [];
  if (det) {
    if (det.slideCount != null) qaChecks.push({ label: `${det.slideCount} slide dirender (${det.pngCount ?? '?'} PNG)`, ok: det.slideCount === det.pngCount });
    if (det.canvas) qaChecks.push({ label: `Kanvas ${det.canvas}`, ok: det.canvas === '1080x1350' });
    if (det.allSlidesPassed != null) qaChecks.push({ label: 'Semua slide lolos cek visual otomatis', ok: !!det.allSlidesPassed });
    if (det.minFontPx != null) qaChecks.push({ label: `Font terkecil ${det.minFontPx}px`, ok: det.minFontPx >= 28 });
    if (det.minContrast != null) qaChecks.push({ label: `Kontras terendah ${det.minContrast}`, ok: det.minContrast >= 4.5 });
  } else if (visualQa) {
    qaChecks.push({ label: `Cek visual otomatis: ${visualQa.passed ? 'lolos' : 'gagal'} (${visualQa.slideCount} slide)`, ok: !!visualQa.passed });
  }
  if (qa?.llmReview) { qaChecks.push({ label: 'Teks sesuai (penilaian QA)', ok: !!qa.llmReview.textOk }); qaChecks.push({ label: 'Desain sesuai (penilaian QA)', ok: !!qa.llmReview.designOk }); }

  return {
    prod,
    title: cleanTitle(order?.title ?? carousel?.topic ?? prod),
    paperclipOk,
    status,
    stats: { slides: slidePngs.length, candidates: research?.candidates?.length ?? 0, verified, sources: (carousel?.sources ?? []).length, qa: handoff ? 'lolos' : qa ? (qa.passed ? 'lolos (agen)' : 'belum') : '—' },
    stages: stageStates({ have, job: job?.identifier === prod ? job : null, mtimes, holdCount }),
    hold: holdCount ? { missing: hold.missing.map((m) => ({ file: m.file, reason: String(m.reason ?? '').slice(0, 200) })) } : null,
    qaHistory,
    slidesFrom: !slidePngs.length && fallbackSlides?.files?.length ? fallbackSlides.label : null,
    slides: (slidePngs.length ? slidePngs : (fallbackSlides?.files ?? [])).map((p, i) => ({ index: i + 1, image: p })),
    contactSheet: contact,
    caption: carousel?.caption ?? null,
    hashtags: carousel?.hashtags ?? [],
    sources: (carousel?.sources ?? []).map((s) => ({ id: s.candidateId, name: s.source_name, url: s.url, title: titleOf.get(s.candidateId)?.title ?? null })),
    master: master ? { id: master.id, identifier: master.identifier, status: master.status, hasHandoff: !!handoff, contentHash: handoff?.contentHash ?? null } : null,
    manager: order ? { title: cleanTitle(order.title), plans: Object.entries(order.stages ?? {}).map(([k, v]) => ({ agent: STAGE_ORDER.find((s) => s.key === k)?.agent ?? k, instruction: String(v) })) } : null,
    research: research ? { count: research.candidates.length, windowDays: research.windowDays, items: research.candidates.map((c) => ({ id: c.id, title: c.title, source: c.source_name, date: c.published_at, summary: c.summary, url: c.url, offWhitelist: !!c.non_whitelist })) } : null,
    verification: verification ? { verified, total: verification.results.length, items: verification.results.map((r) => ({ id: r.candidateId, title: titleOf.get(r.candidateId)?.title ?? r.url, status: r.status, ok: r.status === 'verified', notes: verdictText(r.checks), reason: r.reason ?? null })) } : null,
    copy: carousel ? { topic: carousel.topic, angle: carousel.angle, slides: carousel.slides.map((s) => ({ index: s.index, role: s.role, roleLabel: ROLE[s.role] ?? s.role, heading: s.heading, body: s.body, emphasis: s.emphasis ?? [], sources: (s.sourceRefs ?? []).map((id) => titleOf.get(id)?.source_name ?? id) })) } : null,
    design: design ? { variants: [...new Set(design.slides.map((s) => s.colorVariant))].map((v) => VARIANT[v] ?? v), slides: design.slides.map((s) => ({ index: s.index, template: TEMPLATE[s.template] ?? s.template, variant: VARIANT[s.colorVariant] ?? s.colorVariant, icon: s.icon ?? null, emphasis: s.emphasis ?? [], image: slidePngs[s.index - 1] ?? null })) } : null,
    qa: (qa || handoff || visualQa) ? {
      official: handoff ? { passed: true, label: 'Lolos QA resmi (plugin): semua cek lolos, paket disegel dan diserahkan', contentHash: handoff.contentHash ?? null } : null,
      agentPassed: qa ? !!qa.passed : null,
      checks: qaChecks,
      notes: (Array.isArray(qa?.notes) ? qa.notes : []).map(String),
      verdict: qa?.verdict ?? null,
    } : null,
  };
}
