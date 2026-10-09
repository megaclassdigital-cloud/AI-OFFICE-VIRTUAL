// orchestrator-core.mjs — pure state machine for the production pipeline (no I/O, no LLM).
// The Manager (LLM) only writes a work order; this code decides what happens next. Approval stays with the owner.

export const STAGES = ['researcher', 'verifier', 'copywriter', 'designer', 'qa'];
export const STAGE_AGENT = { researcher: 'Researcher', verifier: 'Verifier', copywriter: 'Copywriter', designer: 'Designer', qa: 'QA' };
export const LIMITS = Object.freeze({ planningTimeoutMs: 20 * 60_000, stageTimeoutMs: 30 * 60_000, maxPlanRetries: 2, maxStageRetries: 1, maxStageAttempts: 3, maxNetRetries: 20, maxText: 4000 });

/** Galat jaringan (permintaan agent tidak sampai ke penyedia): ditangani sebagai "tunggu online", bukan kegagalan tahap. */
export const isNetworkError = (text) => /cannot connect to api|unable to connect|socket connection was closed|econnreset|enotfound|etimedout|eai_again|fetch failed|getaddrinfo|network|typo in the url|connection (was )?(refused|reset)/i.test(String(text ?? ''));

/** Galat sementara dari penyedia model (bukan salah tugas): layak diulang otomatis. */
const TRANSIENT_RE = /\b50[0-4]\b|high demand|overloaded|unavailable|temporar|timed? ?out|econnreset|etimedout|rate.?limit|too many requests|\b429\b|requests ending with a model turn|terminal service failure|cannot connect to api|unable to connect|socket connection was closed/i;
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
  if (!data.passed) return { ok: false, fatal: true, errors: [`QA menolak: ${(Array.isArray(data.notes) ? data.notes : [data.notes ?? 'tanpa catatan']).join('; ').slice(0, 300)}`] };
  return { ok: true, errors: [] };
}
const DONE_STATUSES = new Set(['in_review', 'done']);

/** Validate a Manager work order. Returns { ok, errors }. Every problem is reported, not just the first. */
export function validateOrder(order) {
  const errors = [];
  if (!order || typeof order !== 'object' || Array.isArray(order)) return { ok: false, errors: ['order bukan objek JSON'] };
  if (typeof order.title !== 'string' || !order.title.trim()) errors.push('title wajib');
  if (!order.stages || typeof order.stages !== 'object') errors.push('stages wajib (objek)');
  else {
    for (const s of STAGES) {
      const v = order.stages[s];
      if (typeof v !== 'string' || !v.trim()) errors.push(`stages.${s} wajib (teks instruksi)`);
      else if (v.length > LIMITS.maxText) errors.push(`stages.${s} terlalu panjang (>${LIMITS.maxText})`);
    }
    for (const k of Object.keys(order.stages)) if (!STAGES.includes(k)) errors.push(`stages.${k} bukan tahap yang dikenal`);
  }
  return { ok: errors.length === 0, errors };
}

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
    if (DONE_STATUSES.has(st.status)) {
      // Gerbang keluaran (bila disediakan): berkas harus ada dan lolos validasi sebelum lanjut.
      if (facts.output && !facts.output.ok) {
        if (facts.output.fatal) block(`tahap ${STAGE_AGENT[stageName]} ditolak: ${facts.output.errors.join('; ')}`);
        else if ((j.stageRetries ?? 0) >= LIMITS.maxStageRetries) block(`keluaran tahap ${STAGE_AGENT[stageName]} tetap tidak lolos: ${facts.output.errors.join('; ')}`);
        else { j.stageRetries = (j.stageRetries ?? 0) + 1; actions.push({ type: 'rejectStage', errors: facts.output.errors }); }
        return { job: j, actions };
      }
      j.stageRetries = 0;
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
  ].filter(Boolean).join('\n\n');
}
