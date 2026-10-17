// orchestrator-core.mjs — pure state machine for the production pipeline (no I/O, no LLM).
// The Manager (LLM) only writes a work order; this code decides what happens next. Approval stays with the owner.

export const STAGES = ['researcher', 'verifier', 'copywriter', 'designer', 'qa'];
export const STAGE_AGENT = { researcher: 'Researcher', verifier: 'Verifier', copywriter: 'Copywriter', designer: 'Designer', qa: 'QA' };
export const LIMITS = Object.freeze({ planningTimeoutMs: 20 * 60_000, stageTimeoutMs: 30 * 60_000, maxPlanRetries: 2, maxStageRetries: 1, maxStageAttempts: 3, maxNetRetries: 20, maxText: 4000, maxResearchLoops: 2, maxQaLoops: 2, minVerified: 3 });

/** Galat jaringan (permintaan agent tidak sampai ke penyedia): ditangani sebagai "tunggu online", bukan kegagalan tahap. */
export const isNetworkError = (text) => /cannot connect to api|unable to connect|socket connection was closed|econnreset|enotfound|etimedout|eai_again|fetch failed|getaddrinfo|network|typo in the url|connection (was )?(refused|reset)/i.test(String(text ?? ''));

/** Galat sementara dari penyedia model (bukan salah tugas): layak diulang otomatis. */
const TRANSIENT_RE = /\b50[0-4]\b|high demand|overloaded|unavailable|temporar|timed? ?out|econnreset|etimedout|rate.?limit|too many requests|\b429\b|requests ending with a model turn|terminal service failure|cannot connect to api|unable to connect|socket connection was closed/i;
/**
 * Galat run Manager yang bisa pulih tanpa campur tangan owner: kuota/limit (failover berpindah ChatGPT <-> Claude), login, atau sesi adapter gagal diinisialisasi.
 * Perencanaan tidak boleh langsung diblokir karenanya; Paperclip mencoba ulang dan failover berpindah model (batas waktu perencanaan tetap melindungi).
 */
export const isManagerRetryable = (text) => /acpx_session_init_failed|ensure_session|internal error|quota|usage limit|limit reached|exhausted|resource_exhausted|rate.?limit|too many requests|\b429\b|not logged in|login required|authentication required/i.test(String(text ?? ''));
export const isTransientError = (text) => TRANSIENT_RE.test(String(text ?? ''));

/** Keluaran baku tiap tahap: nama berkas (di workspace/agent/runs/<ID>/) dan skema yang memvalidasinya. */
export const STAGE_OUTPUT = Object.freeze({
  // Researcher hanya menulis kandidat mentah; KODE (normalize-research.mjs) menambah id/generatedAt/windowDays lalu menulis research-output.json.
  researcher: { file: 'research-raw.json', schema: null, produces: 'research-output.json' },
  verifier: { file: 'verification-result.json', schema: 'verification-result' },
  copywriter: { file: 'carousel.json', schema: 'carousel' },
  designer: { file: 'carousel-design.json', schema: 'carousel-design' },
  qa: { file: 'qa-result.json', schema: null },
});

/** Path keluaran tahap (pemisah mengikuti `sep`; Windows memakai backslash di prompt agent). */
export const outputPath = (outputsDir, identifier, stage, sep = '/') => [outputsDir.replace(/[\\/]+$/, ''), 'runs', identifier, STAGE_OUTPUT[stage].file].join(sep);

/** Berkas yang dibaca tahap berikutnya (hasil normalisasi kode bila ada, selain itu berkas keluaran agent). */
export const artifactPath = (outputsDir, identifier, stage, sep = '/') => [outputsDir.replace(/[\\/]+$/, ''), 'runs', identifier, STAGE_OUTPUT[stage].produces ?? STAGE_OUTPUT[stage].file].join(sep);

/** QA result gate (no schema): must be an object with boolean `passed`; passed=false is a fatal verdict, not a retry. */
export function checkQaResult(data) {
  if (!data || typeof data !== 'object' || typeof data.passed !== 'boolean') return { ok: false, errors: ['qa-result.json harus objek dengan "passed": true/false dan "notes": [..]'] };
  if (data.passed && !(data.llmReview && typeof data.llmReview.textOk === 'boolean' && typeof data.llmReview.designOk === 'boolean')) return { ok: false, errors: ['qa-result.json dengan passed=true wajib memuat "llmReview": {"textOk": true|false, "designOk": true|false}'] };
  // Penilaian desain WAJIB eksplisit per aspek (layout, foto, font): QA tidak boleh meloloskan tanpa benar-benar memeriksa tiap aspek terhadap acuan.
  const dr = data.designReview;
  const drOk = dr && DESIGN_ASPECTS.every((k) => typeof dr[k] === 'boolean');
  if (data.passed) {
    if (!drOk) return { ok: false, errors: [`qa-result.json dengan passed=true wajib memuat "designReview": {${DESIGN_ASPECTS.map((k) => `"${k}": true|false`).join(', ')}} hasil pemeriksaan tiap aspek terhadap gambar acuan`] };
    const bad = DESIGN_ASPECTS.filter((k) => dr[k] === false);
    if (bad.length) return { ok: false, errors: [`passed=true bertentangan dengan designReview (${bad.join(', ')} = false); tulis passed=false dan returnTo departemen yang merevisi`] };
  }
  if (!data.passed) {
    const notes = (Array.isArray(data.notes) ? data.notes : [data.notes ?? 'tanpa catatan']).map((n) => (typeof n === 'string' ? n : JSON.stringify(n)));
    const errors = [`QA menolak: ${notes.join('; ').slice(0, 300)}`];
    // QA memilih departemen yang harus merevisi: "returnTo" (researcher|copywriter|designer) atau disimpulkan dari llmReview/designReview. Tanpa petunjuk = vonis fatal seperti dulu.
    const want = [].concat(data.returnTo ?? []).map((x) => String(x).toLowerCase());
    let to = QA_RETURN_STAGES.filter((s) => want.includes(s));
    // "fromScratch": isi/sumber tidak valid secara mendasar -> bikin ulang dari awal (Researcher), hasil lama diarsipkan rapi, bukan ditimpa.
    const scratch = data.fromScratch === true;
    if (scratch) to = ['researcher'];
    if (!to.length && data.llmReview?.textOk === false) to = ['copywriter'];
    if (!to.length && (data.llmReview?.designOk === false || (drOk && DESIGN_ASPECTS.some((k) => dr[k] === false)))) to = ['designer'];
    if (!to.length) return { ok: false, fatal: true, errors };
    return { ok: false, qaReturn: { to: to[0], departments: to, notes, scratch }, errors };
  }
  return { ok: true, errors: [] };
}
/** Aspek desain yang wajib dinilai QA satu per satu terhadap acuan (patokan format owner). */
export const DESIGN_ASPECTS = ['layout', 'photo', 'font'];
/** Departemen yang boleh diminta QA untuk merevisi, urut dari hulu; revisi dari yang paling hulu, tahap sesudahnya otomatis berjalan ulang. */
export const QA_RETURN_STAGES = ['researcher', 'copywriter', 'designer'];

/** Teks umpan balik QA yang ditempelkan ke perintah tahap yang diulang. */
export function qaFeedbackText(notes, stage, round, scratch = false) {
  const head = scratch
    ? `REVISI DARI QA (putaran ${round}): isi/sumber sebelumnya dinyatakan TIDAK VALID. Kerjakan DARI AWAL dengan sumber dan kandidat baru; hasil lama sudah diarsipkan, jangan dipakai ulang.`
    : `REVISI DARI QA (putaran ${round}): hasilmu ditolak QA. Perbaiki HANYA yang disebut, jangan mengubah yang sudah benar, lalu serahkan ulang.`;
  const imgRule = stage === 'designer' && !scratch
    ? '\nATURAN GAMBAR REVISI: gambar yang DITOLAK QA wajib diganti dan DIAMBIL ULANG, jadi pakai NAMA BERKAS BARU (mis. tambah -v2) dan perbarui query di asset-requests.json. Gambar yang TIDAK disebut QA jangan diubah namanya: dipakai ulang tanpa pengambilan ulang.'
    : '';
  return `${head}${imgRule}\nDepartemen yang diminta merevisi: ${STAGE_AGENT[stage]}.\nCatatan QA:\n- ${notes.join('\n- ').slice(0, 1500)}`;
}
const DONE_STATUSES = new Set(['in_review', 'done']);

/**
 * Ringkas hasil Verifier untuk keputusan "kembali ke Researcher". Murni dan deterministik.
 * minVerified: dari work order (field opsional `minVerified`, 1-10) atau LIMITS.minVerified.
 */
export function summarizeVerification(vr, order = null) {
  const rs = Array.isArray(vr?.results) ? vr.results : [];
  const asked = Number(order?.minVerified);
  const minVerified = Number.isInteger(asked) && asked >= 1 && asked <= 10 ? asked : LIMITS.minVerified;
  return {
    total: rs.length, minVerified,
    verified: rs.filter((r) => r.status === 'verified').length,
    verifiedUrls: rs.filter((r) => r.status === 'verified').map((r) => r.url).filter(Boolean),
    rejected: rs.filter((r) => r.status !== 'verified').map((r) => ({ candidateId: r.candidateId, url: r.url, reason: String(r.reason ?? 'ditolak tanpa alasan').slice(0, 200) })),
  };
}

/** Pesan umpan balik untuk Researcher saat Verifier menolak terlalu banyak kandidat. */
export function researchFeedbackText(v, round) {
  const lines = v.rejected.slice(0, 12).map((r) => `- ${r.url ?? r.candidateId}: ${r.reason}`);
  return [
    `PUTARAN RISET ULANG ${round} (dari Verifier): hanya ${v.verified} dari ${v.total} kandidat terverifikasi; dibutuhkan minimal ${v.minVerified}.`,
    'Kandidat yang DITOLAK (jangan ulangi URL atau sumber yang sama):', ...lines,
    v.verifiedUrls.length ? 'Kandidat yang sudah terverifikasi (pertahankan di daftar, jangan hapus):\n' + v.verifiedUrls.map((u) => '- ' + u).join('\n') : '',
    'Tugasmu: tulis ulang research-raw.json berisi kandidat terverifikasi di atas DITAMBAH kandidat pengganti baru sampai total 5-10. Buka tiap halaman sungguhan, ambil tanggal terbit dari halamannya (maks. 7 hari), dan jangan menebak URL. Utamakan halaman resmi (blog/newsroom penerbit) daripada pemberitaan turunan.',
  ].filter(Boolean).join('\n');
}

/** Validate a Manager work order. Returns { ok, errors }. Every problem is reported, not just the first. */
export const MAX_EXTRA_CONTENTS = 2;
const validateStages = (stages, prefix, errors) => {
  if (!stages || typeof stages !== 'object' || Array.isArray(stages)) { errors.push(`${prefix}stages wajib (objek)`); return; }
  for (const s of STAGES) {
    const v = stages[s];
    if (typeof v !== 'string' || !v.trim()) errors.push(`${prefix}stages.${s} wajib (teks instruksi)`);
    else if (v.length > LIMITS.maxText) errors.push(`${prefix}stages.${s} terlalu panjang (>${LIMITS.maxText})`);
  }
  for (const k of Object.keys(stages)) if (!STAGES.includes(k)) errors.push(`${prefix}stages.${k} bukan tahap yang dikenal`);
};

/**
 * Validate a Manager work order. Returns { ok, errors }. Every problem is reported, not just the first.
 * Bentuk: { title, stages, analysis?, extraContents?: [{title, stages}] (maks MAX_EXTRA_CONTENTS konten tambahan dari brief yang sama), ownerQuestions?: [teks] }.
 */
export function validateOrder(order) {
  const errors = [];
  if (!order || typeof order !== 'object' || Array.isArray(order)) return { ok: false, errors: ['order bukan objek JSON'] };
  if (typeof order.title !== 'string' || !order.title.trim()) errors.push('title wajib');
  validateStages(order.stages, '', errors);
  if (order.extraContents !== undefined) {
    if (!Array.isArray(order.extraContents)) errors.push('extraContents harus berupa daftar');
    else {
      if (order.extraContents.length > MAX_EXTRA_CONTENTS) errors.push(`extraContents maksimal ${MAX_EXTRA_CONTENTS} (brief dengan lebih banyak topik: pilih yang utama, sisanya dilaporkan di analysis)`);
      order.extraContents.slice(0, MAX_EXTRA_CONTENTS + 1).forEach((c, i) => {
        if (!c || typeof c.title !== 'string' || c.title.trim().length < 3) errors.push(`extraContents[${i}].title wajib`);
        validateStages(c?.stages, `extraContents[${i}].`, errors);
      });
    }
  }
  if (order.ownerQuestions !== undefined && (!Array.isArray(order.ownerQuestions) || order.ownerQuestions.length > 3 || order.ownerQuestions.some((q) => typeof q !== 'string' || q.length > 300))) errors.push('ownerQuestions harus daftar maksimal 3 teks (maks 300 karakter)');
  return { ok: errors.length === 0, errors };
}

/** Konten tambahan (dari brief yang sama) yang sudah tervalidasi: [{ title, stages }]. */
export const extraContentsOf = (order) => (Array.isArray(order?.extraContents) ? order.extraContents.slice(0, MAX_EXTRA_CONTENTS).map((c) => ({ title: String(c.title).trim(), stages: c.stages })) : []);

/** Analisis Manager yang dinormalisasi untuk ditampilkan ke owner. */
export function analysisOf(order) {
  const a = order?.analysis ?? {};
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 300)).slice(0, 6) : []);
  return { topics: list(a.topics), assumptions: list(a.assumptions), risks: list(a.risks), unknownEntities: list(a.unknownEntities), ownerQuestions: list(order?.ownerQuestions).slice(0, 3) };
}

/** Teks komentar untuk owner: apa yang dipahami Manager dari brief, asumsi, risiko, dan pertanyaan (bahasa sederhana). */
export function renderAnalysisComment(order) {
  const a = analysisOf(order);
  const extra = extraContentsOf(order);
  const lines = [`Rencana Manager siap: "${String(order?.title ?? '').slice(0, 120)}".`];
  if (a.topics.length) lines.push(`Topik yang saya pahami dari brief: ${a.topics.join('; ')}.`);
  if (extra.length) lines.push(`Brief ini memuat ${1 + extra.length} konten terpisah: konten utama diproses lebih dulu, lalu ${extra.map((c) => '"' + c.title + '"').join(', ')} mengantre sebagai konten sendiri (kode konten berbeda).`);
  if (a.unknownEntities.length) lines.push(`Perlu dipastikan (tidak saya kenal): ${a.unknownEntities.join('; ')}. Researcher/Verifier diminta memastikan keberadaannya lewat sumber resmi.`);
  if (a.assumptions.length) lines.push(`Asumsi: ${a.assumptions.join('; ')}.`);
  if (a.risks.length) lines.push(`Risiko: ${a.risks.join('; ')}.`);
  if (a.ownerQuestions.length) lines.push(`Pertanyaan untuk Anda (tidak menahan pekerjaan; koreksi lewat revisi bila perlu): ${a.ownerQuestions.join(' | ')}`);
  return lines.join(' ');
}

/** Nama berkas keluaran baku tiap tahap (di folder run). Manager wajib memakai nama ini; kode memperbaiki alias umum dan menolak nama karangan. */
export const CANONICAL_FILES = ['research-raw.json', 'research-output.json', 'verification-result.json', 'carousel.json', 'carousel-design.json', 'asset-requests.json', 'assets-manifest.json', 'qa-result.json'];
const OTHER_KNOWN_JSON = new Set(['templates.json', 'brand.json', 'limits.json', 'agent-models.json']);
const FILE_ALIASES = {
  'verify-result.json': 'verification-result.json', 'verification-results.json': 'verification-result.json', 'verification.json': 'verification-result.json', 'verify.json': 'verification-result.json',
  'carousel-copy.json': 'carousel.json', 'carousel-draft.json': 'carousel.json', 'carousel-text.json': 'carousel.json', 'copy.json': 'carousel.json',
  'design.json': 'carousel-design.json', 'carousel-design-spec.json': 'carousel-design.json', 'design-spec.json': 'carousel-design.json',
  'qa-report.json': 'qa-result.json', 'qa-results.json': 'qa-result.json', 'qa.json': 'qa-result.json',
  'research.json': 'research-raw.json', 'research-results.json': 'research-raw.json', 'research-result.json': 'research-raw.json',
};
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
const aliasRe = (alias) => new RegExp('(?<![A-Za-z0-9_-])' + escapeRe(alias) + '(?![A-Za-z0-9_-])', 'g');
/**
 * Perbaiki alias nama berkas (mis. verify-result.json -> verification-result.json) di semua instruksi tahap (konten utama dan tambahan).
 * Mengembalikan { order (salinan), changed, replaced:[{from,to}] }.
 */
export function normalizeOrderFileNames(order) {
  const replaced = [];
  const fix = (text) => {
    let out = String(text ?? '');
    for (const [alias, canon] of Object.entries(FILE_ALIASES)) {
      const re = aliasRe(alias);
      if (re.test(out)) { out = out.replace(aliasRe(alias), canon); if (!replaced.some((r) => r.from === alias)) replaced.push({ from: alias, to: canon }); }
    }
    return out;
  };
  const fixStages = (stages) => (stages && typeof stages === 'object' ? Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, fix(v)])) : stages);
  const copy = { ...order, stages: fixStages(order?.stages) };
  if (Array.isArray(order?.extraContents)) copy.extraContents = order.extraContents.map((c) => ({ ...c, stages: fixStages(c?.stages) }));
  return { order: copy, changed: replaced.length > 0, replaced };
}
/** Nama berkas .json di instruksi yang bukan keluaran baku dan bukan berkas konfigurasi yang dikenal (kemungkinan karangan Manager). */
export function findUnknownFileNames(order) {
  const texts = [...Object.values(order?.stages ?? {}), ...extraContentsOf(order).flatMap((c) => Object.values(c.stages ?? {}))].map(String);
  const found = new Set();
  for (const t of texts) for (const m of t.matchAll(/[A-Za-z0-9_-]+[.]json/g)) {
    const n = m[0];
    if (CANONICAL_FILES.includes(n) || OTHER_KNOWN_JSON.has(n) || /^EDU-[0-9]+[.]json$/.test(n)) continue;
    found.add(n);
  }
  return [...found];
}

export const ORDER_LABELS = ['Tujuan', 'Masukan', 'Batasan', 'Keluaran'];
/**
 * Struktur wajib instruksi tahap dari Manager (template di divisions/edukasiai/sop/work-order-templates.md): minimal 3 dari 4 label
 * (Tujuan:, Masukan:, Batasan:, Keluaran:) masing-masing di awal baris. Tahap "Dilewati" tidak diperiksa. Mengembalikan { ok, errors }.
 */
export function checkOrderStructure(order) {
  const errors = [];
  const checkStages = (stages, prefix) => {
    for (const stage of STAGES) {
      const text = String(stages?.[stage] ?? '');
      if (/^\s*Dilewati/i.test(text)) continue;
      const lines = text.split(/\r?\n/).map((l) => l.trim().toLowerCase());
      const missing = ORDER_LABELS.filter((l) => !lines.some((ln) => ln.startsWith(l.toLowerCase() + ':')));
      if (ORDER_LABELS.length - missing.length < 3) errors.push(`${prefix}stages.${stage} harus berstruktur: tulis label ${ORDER_LABELS.map((l) => l + ':').join(' ')} masing-masing di awal baris (kurang: ${missing.join(', ')})`);
    }
  };
  checkStages(order?.stages, '');
  extraContentsOf(order).forEach((c, i) => checkStages(c.stages, `extraContents[${i}].`));
  const unknown = findUnknownFileNames(order);
  if (unknown.length) errors.push('instruksi menyebut berkas yang bukan keluaran baku: ' + unknown.join(', ') + '. Pakai nama baku persis: ' + CANONICAL_FILES.join(', '));
  // analisis wajib: Manager harus menghitung topik dan menandai nama/produk yang tidak dikenal SEBELUM merencanakan
  const topics = order?.analysis?.topics;
  if (!Array.isArray(topics) || !topics.length || topics.some((t) => typeof t !== 'string' || t.trim().length < 3)) errors.push('analysis.topics wajib: daftar topik yang kamu temukan di brief (1 bila satu topik); isi juga analysis.assumptions, analysis.risks, analysis.unknownEntities (daftar, boleh kosong)');
  return { ok: errors.length === 0, errors };
}

/**
 * Brief revisi: front matter `mode: revisi`, `dari: EDU-n` (run sumber), `mulai: researcher|copywriter|designer` (researcher = riset diulang dari awal).
 * Tahap sebelum `mulai` memakai artefak run sumber (tanpa memanggil agent/kuota). Mengembalikan { from, start, startIndex, notes } atau null.
 */
export function parseRevisionBrief(brief) {
  const m = String(brief ?? '').match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = Object.fromEntries(m[1].split(/\r?\n/).map((l) => l.match(/^\s*([A-Za-z-]+)\s*:\s*(.+?)\s*$/)).filter(Boolean).map((x) => [x[1].toLowerCase(), x[2]]));
  if (String(meta.mode ?? '').toLowerCase() !== 'revisi') return null;
  const from = meta.dari;
  const start = String(meta.mulai ?? 'designer').toLowerCase();
  if (!/^EDU-[0-9]+(?:\/revision-[0-9]+)?$/.test(from ?? '') || !['researcher', 'copywriter', 'designer'].includes(start)) return null;
  return { from, start, startIndex: STAGES.indexOf(start), notes: m[2].trim() };
}

/** Kunci folder run sebuah job: revisi memakai EDU-49/revision-N; job lama tanpa runKey memakai identifier-nya. */
export const runKeyOf = (job) => job?.runKey ?? job?.identifier;

// ── Jalur perakitan (pipeline): beberapa konten berjalan bersamaan, tetapi tiap agent hanya memegang SATU konten pada satu waktu ──
/** Jumlah konten aktif maksimal di jalur (menjaga kuota dan antrean approval). */
export const MAX_ACTIVE_JOBS = 3;
/**
 * Jalur (indeks tahap) yang sedang dipakai sebuah job, atau null. Job yang baru dipromosikan (planning) memakai jalur 0 (Researcher);
 * job running memakai jalur tahapnya SAMPAI tahap itu selesai (laneWait = tahap sudah selesai, menunggu jalur berikutnya bebas, jalur lama sudah dilepas).
 */
export const laneOf = (job) => {
  if (!job || ['done', 'blocked'].includes(job.phase)) return null;
  if (job.phase === 'planning') return 0;
  if (job.phase === 'running' && !job.laneWait && job.stageIssueId) return job.stageIndex;
  return null;
};
export const occupiedLanes = (jobs = []) => new Set(jobs.map(laneOf).filter((x) => x !== null));
/** Job yang akan maju ke tahap berikutnya harus menunggu bila jalur itu masih dipegang job di depannya (urutan konten tidak pernah saling mendahului). */
export const mustWaitForLane = (before, after, occupied) => Boolean(before?.phase === 'running' && after?.phase === 'running' && after.stageIndex > before.stageIndex && after.stageIndex < STAGES.length && occupied.has(after.stageIndex));
/**
 * Satu keputusan memajukan sebuah konten (dipakai orkestrator DAN simulasi tes): jalankan step(), lalu tahan bila tahap berikutnya masih dipegang konten di depannya.
 * Berlaku sama untuk SEMUA tahap/agent (Researcher, Verifier, Copywriter, Designer, QA).
 * @returns {{ wait: boolean, job: object, actions: object[] }}
 */
export function decideAdvance(job, facts, occupied) {
  const { job: next, actions } = step(job, facts);
  const merged = { ...job, ...next };
  if (mustWaitForLane(job, merged, occupied)) return { wait: true, job: { ...job, laneWait: true }, actions: [] };
  merged.laneWait = false;
  return { wait: false, job: merged, actions };
}
/** Rencana siap boleh dipromosikan bila jalur Researcher (0) bebas dan konten aktif belum mencapai batas. */
export const canPromote = (jobs = [], max = MAX_ACTIVE_JOBS) => {
  const live = jobs.filter((j) => j && !['done', 'blocked'].includes(j.phase));
  return live.length < max && !occupiedLanes(live).has(0);
};

/** Berapa brief yang boleh direncanakan Manager di muka selagi job lain berjalan (menjaga kuota Manager). */
export const MAX_PENDING_PLANS = 1;
/** Boleh merencanakan brief berikutnya di muka? Hanya selama ada job aktif dan slot rencana belum penuh. */
export const canPlanAhead = (job, pending = [], max = MAX_PENDING_PLANS) => Boolean(job && !['done', 'blocked'].includes(job.phase) && pending.filter((p) => !p.hold && !p.ready).length < max);
/** Rencana siap yang paling lama menunggu giliran (FIFO), atau null. */
export const nextPlanned = (pending = []) => pending.find((p) => p.ready && !p.hold) ?? null;
/** Rencana yang ditahan owner (hold) tidak dievaluasi, tidak dipromosikan, dan tidak menghalangi brief lain. */
export const activePending = (pending = []) => pending.filter((p) => !p.hold);

export const newJob = ({ masterIssueId, identifier, nowMs }) => ({
  masterIssueId, identifier, phase: 'planning', stageIndex: -1, stageIssueId: null, createdMs: nowMs, stageStartedMs: null, planRetries: 0,
});

/**
 * One decision step. facts:
 *  - order: { ok, errors } | null  (null = file work order belum ada)
 *  - managerFinished: boolean       (run Manager untuk issue master sudah selesai)
 *  - stage: { status, failed, error } | null  (issue tahap berjalan)
 *  - nowMs
 * Returns { job, actions } where actions are { type: 'createStage'|'comment'|'rewakeManager'|'finish'|'block', ... }.
 */
export function step(job, facts) {
  const j = { ...job };
  const actions = [];
  // Jam internal: selama offline, waktu tidak dihitung ke batas waktu perencanaan/tahap (digeser maju sebesar selang tick).
  const dt = j.lastTickMs ? Math.max(0, facts.nowMs - j.lastTickMs) : 0;
  j.lastTickMs = facts.nowMs;
  if (facts.offline && (j.phase === 'planning' || j.phase === 'running')) {
    j.createdMs += dt;
    if (j.stageStartedMs) j.stageStartedMs += dt;
    if (!j.heldSince) j.heldSince = facts.nowMs;
    return { job: j, actions };
  }
  if (j.heldSince) j.heldSince = null;
  const block = (reason) => { j.phase = 'blocked'; actions.push({ type: 'block', reason }); };

  if (j.phase === 'planning') {
    if (facts.order?.ok) {
      j.phase = 'running'; j.stageIndex = 0; j.stageStartedMs = facts.nowMs;
      actions.push({ type: 'comment', text: `Work order diterima. Mulai tahap 1/${STAGES.length}: ${STAGE_AGENT[STAGES[0]]}.` });
      actions.push({ type: 'createStage', stage: STAGES[0] });
    } else if (facts.order && !facts.order.ok && facts.managerFinished) {
      if (j.planRetries >= LIMITS.maxPlanRetries) block(`work order tetap tidak valid: ${facts.order.errors.join('; ')}`);
      else { j.planRetries += 1; actions.push({ type: 'rewakeManager', errors: facts.order.errors }); }
    } else if (!facts.order && facts.managerFinished) {
      if (j.planRetries >= LIMITS.maxPlanRetries) block('Manager selesai tetapi tidak menulis work order');
      else { j.planRetries += 1; actions.push({ type: 'rewakeManager', errors: ['file work order belum ada di folder orders'] }); }
    } else if (facts.nowMs - j.createdMs > LIMITS.planningTimeoutMs) {
      block('Manager tidak menghasilkan work order dalam batas waktu');
    }
    return { job: j, actions };
  }

  if (j.phase === 'running') {
    const st = facts.stage;
    if (!st) return { job: j, actions };
    const stageName = STAGES[j.stageIndex];
    // QA yang menandai issue-nya 'blocked' SETELAH menulis vonis penolakan dengan tujuan revisi (qaReturn) tetap diproses sebagai putaran revisi, bukan 'tahap terhalang'.
    const qaBlockedWithReturn = st.status === 'blocked' && stageName === 'qa' && !!facts.output?.qaReturn;
    if (DONE_STATUSES.has(st.status) || qaBlockedWithReturn) {
      // Gerbang keluaran (bila disediakan): berkas harus ada dan lolos validasi sebelum lanjut.
      if (facts.output && !facts.output.ok && facts.output.hold) {
        // Tahan menunggu aset asli (owner/inbox/verifikasi): bukan kegagalan, tanpa percobaan ulang, jam tahap tidak berjalan.
        if (j.stageStartedMs) j.stageStartedMs += dt;
        if (!j.assetHoldNotified) { j.assetHoldNotified = true; actions.push({ type: 'holdAssets', text: facts.output.errors.join(String.fromCharCode(10)) }); }
        return { job: j, actions };
      }
      if (facts.output?.qaReturn && stageName === 'qa') {
        // QA meminta revisi langsung ke departemen terkait (maks. LIMITS.maxQaLoops putaran), bukan memblokir job.
        const loops = j.qaLoops ?? 0; const target = facts.output.qaReturn.to;
        if (loops >= LIMITS.maxQaLoops) { block(`QA masih menolak setelah ${loops} putaran revisi (${facts.output.errors.join('; ')}); butuh keputusan owner`); return { job: j, actions }; }
        j.qaLoops = loops + 1; j.stageRetries = 0; j.stageIndex = STAGES.indexOf(target); j.stageIssueId = null; j.stageStartedMs = facts.nowMs; j.stageAttempts = 1; j.assetHoldNotified = false;
        actions.push({ type: 'comment', text: `QA menolak dan meminta revisi ke ${STAGE_AGENT[target]} (putaran ${j.qaLoops} dari ${LIMITS.maxQaLoops}): ${facts.output.qaReturn.notes.join('; ').slice(0, 500)}` });
        const scratch = facts.output.qaReturn.scratch === true;
        actions.push({ type: 'createStage', stage: target, feedback: qaFeedbackText(facts.output.qaReturn.notes, target, j.qaLoops, scratch), archive: `qa-putaran-${j.qaLoops}-${scratch ? 'dari-awal' : target}`, scratch });
        return { job: j, actions };
      }
      if (facts.output && !facts.output.ok) {
        if (facts.output.fatal) block(`tahap ${STAGE_AGENT[stageName]} ditolak: ${facts.output.errors.join('; ')}`);
        else if ((j.stageRetries ?? 0) >= LIMITS.maxStageRetries) block(`keluaran tahap ${STAGE_AGENT[stageName]} tetap tidak lolos: ${facts.output.errors.join('; ')}`);
        else { j.stageRetries = (j.stageRetries ?? 0) + 1; actions.push({ type: 'rejectStage', errors: facts.output.errors }); }
        return { job: j, actions };
      }
      // Hasil Verifier terlalu sedikit yang valid: KEMBALI ke Researcher (maks. LIMITS.maxResearchLoops putaran), bukan lanjut dengan bahan tipis.
      if (stageName === 'verifier' && facts.verification && facts.verification.verified < facts.verification.minVerified) {
        const v = facts.verification; const loops = j.researchLoops ?? 0;
        if (loops < LIMITS.maxResearchLoops) {
          j.researchLoops = loops + 1; j.stageRetries = 0; j.stageIndex = 0; j.stageIssueId = null; j.stageStartedMs = facts.nowMs; j.stageAttempts = 1;
          actions.push({ type: 'comment', text: `Verifier: ${v.verified}/${v.total} kandidat terverifikasi (minimal ${v.minVerified}). Kembali ke Researcher untuk riset ulang (putaran ${j.researchLoops} dari ${LIMITS.maxResearchLoops}).` });
          actions.push({ type: 'createStage', stage: 'researcher', feedback: researchFeedbackText(v, j.researchLoops) });
          return { job: j, actions };
        }
        if (v.verified < 1) { block(`tidak ada kandidat terverifikasi setelah ${loops} putaran riset ulang`); return { job: j, actions }; }
        actions.push({ type: 'comment', text: `Batas putaran riset ulang tercapai; lanjut dengan ${v.verified} kandidat terverifikasi (di bawah target ${v.minVerified}). QA/owner perlu menilai kecukupan bahan.` });
      }
      j.stageRetries = 0; j.assetHoldNotified = false;
      if (j.stageIndex + 1 >= STAGES.length) {
        j.phase = 'done'; j.stageIssueId = null;
        actions.push({ type: 'finish', text: 'Semua tahap selesai. Paket menunggu keputusan owner.' });
      } else {
        j.stageIndex += 1; j.stageIssueId = null; j.stageStartedMs = facts.nowMs; j.stageAttempts = 1;
        actions.push({ type: 'comment', text: `Tahap ${STAGE_AGENT[stageName]} selesai. Lanjut ${j.stageIndex + 1}/${STAGES.length}: ${STAGE_AGENT[STAGES[j.stageIndex]]}.` });
        actions.push({ type: 'createStage', stage: STAGES[j.stageIndex] });
      }
    } else if (st.failed && isNetworkError(st.error) && (j.netRetries ?? 0) < LIMITS.maxNetRetries) {
      // Putus jaringan: ulangi tahap yang sama tanpa menghabiskan jatah percobaan biasa.
      const oldIssueId = j.stageIssueId;
      j.netRetries = (j.netRetries ?? 0) + 1; j.stageStartedMs = facts.nowMs; j.stageIssueId = null;
      actions.push({ type: 'retryStage', stage: stageName, reason: 'jaringan terputus, diulang saat online', network: true, oldIssueId });
    } else if (st.failed && isTransientError(st.error) && (j.stageAttempts ?? 1) < LIMITS.maxStageAttempts) {
      const oldIssueId = j.stageIssueId;
      j.stageAttempts = (j.stageAttempts ?? 1) + 1; j.stageStartedMs = facts.nowMs; j.stageIssueId = null;
      actions.push({ type: 'retryStage', stage: stageName, reason: String(st.error).slice(0, 100), oldIssueId });
    } else if (st.status === 'blocked' || st.failed) {
      block(`tahap ${STAGE_AGENT[stageName]} ${st.failed ? 'gagal' : 'terhalang'}${st.error ? `: ${String(st.error).slice(0, 120)}` : ''}`);
    } else if (facts.nowMs - j.stageStartedMs > LIMITS.stageTimeoutMs) {
      block(`tahap ${STAGE_AGENT[stageName]} melewati batas waktu ${LIMITS.stageTimeoutMs / 60_000} menit`);
    }
    return { job: j, actions };
  }

  return { job: j, actions };
}

/**
 * Path Windows bergaris-miring-terbalik di prompt agent rawan rusak: model membaca "\r" (runs), "\t" (tools), "\n" sebagai karakter kontrol
 * (bukti EDU-45: "runs" menjadi "uns"). Semua path berawalan drive diubah ke garis miring maju, yang diterima Windows dan Node.
 */
export const forwardSlashPaths = (text) => String(text ?? '').replace(/[A-Za-z]:\\[^\s"'`)\]]*/g, (m) => m.replace(/\\/g, '/'));

/** Text of the stage issue the orchestrator creates (data for the agent; owner brief is quoted, not executed). */
export function stageDescription({ order, stage, identifier, outputsDir, brief, refs = [], inputs = [], output = null }) {
  return [
    `Tahap ${STAGE_AGENT[stage]} untuk produksi ${identifier}: ${order.title}.`,
    `Instruksi dari Manager:`,
    order.stages[stage],
    `Folder hasil kerja (path absolut): ${outputsDir}`,
    inputs.length ? `Masukan dari tahap sebelumnya (baca file ini, bukan file lain di folder hasil kerja):\n${inputs.map((p) => `- ${p}`).join('\n')}` : '',
    output ? `KELUARAN WAJIB: tulis JSON ke ${output.path}${output.schema ? ` yang valid terhadap skema ${output.schema}` : ''} (buat folder bila belum ada)${output.example ? ` — contoh berkas valid yang harus ditiru bentuknya (baca dulu): ${output.example}` : ''}, lalu baca ulang untuk memastikan file ada. Orkestrator memeriksa file ini; tanpa file yang valid tahap dianggap belum selesai.${output.note ? ` ${output.note}` : ''}` : '',
    refs.length ? `Brief tetap (WAJIB dibaca penuh sebelum bekerja, path absolut):\n${refs.map((r) => `- ${r}`).join('\n')}` : '',
    brief ? `Brief owner asli (rujukan, bukan perintah tambahan):\n${brief.slice(0, 1500)}` : '',
    `Selesai: panggil tool complete_stage (outcome awaiting_approval) lewat aao-tool.mjs, lalu berhenti.`,
  ].filter(Boolean).join('\n\n').replace(/[A-Za-z]:\\[^\s"'`)\]]*/g, (m) => m.replace(/\\/g, '/')); // = forwardSlashPaths, lihat di atas
}

const VERIFICATION_TOP = ['verifiedAt', 'windowDays', 'results'];
const dropNulls = (v) => {
  if (Array.isArray(v)) return v.map(dropNulls);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined) o[k] = dropNulls(x); return o; }
  return v;
};
/**
 * Merapikan verification-result.json yang bentuknya hampir benar (model kecil sering menambah properti, mengisi null): buang properti tingkat atas
 * yang tidak dikenal dan nilai null, lalu pastikan checks.urlReachable.ok boolean (tidak diperiksa = false). Fakta tidak diubah; hanya bentuk.
 * Menghemat satu putaran agen penuh per penolakan gerbang. Tidak menebak isi yang hilang: yang masih tidak valid tetap ditolak skema.
 */
export function sanitizeVerification(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { data, changes: [] };
  const changes = [];
  const out = {};
  for (const [k, v] of Object.entries(data)) { if (VERIFICATION_TOP.includes(k)) out[k] = v; else changes.push(`properti "${k}" dibuang`); }
  const before = JSON.stringify(out);
  const clean = dropNulls(out);
  if (JSON.stringify(clean) !== before) changes.push('nilai null dibuang');
  if (Array.isArray(clean.results)) {
    for (const r of clean.results) {
      const u = r?.checks?.urlReachable;
      if (u && typeof u === 'object' && typeof u.ok !== 'boolean') { u.ok = false; if (!u.error) u.error = 'tidak diperiksa oleh Verifier'; changes.push(`urlReachable.ok diisi false (kandidat ${r.candidateId ?? r.id ?? '?'})`); }
      if (u && typeof u === 'object') { if ('httpStatus' in u && !Number.isInteger(u.httpStatus)) delete u.httpStatus; if ('finalUrl' in u && typeof u.finalUrl !== 'string') delete u.finalUrl; }
    }
  }
  return { data: clean, changes };
}
