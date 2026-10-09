// orchestrator-core.mjs — pure state machine for the production pipeline (no I/O, no LLM).
// The Manager (LLM) only writes a work order; this code decides what happens next. Approval stays with the owner.

export const STAGES = ['researcher', 'verifier', 'copywriter', 'designer', 'qa'];
export const STAGE_AGENT = { researcher: 'Researcher', verifier: 'Verifier', copywriter: 'Copywriter', designer: 'Designer', qa: 'QA' };
export const LIMITS = Object.freeze({ planningTimeoutMs: 20 * 60_000, stageTimeoutMs: 30 * 60_000, maxPlanRetries: 2, maxText: 4000 });
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
      if (j.stageIndex + 1 >= STAGES.length) {
        j.phase = 'done'; j.stageIssueId = null;
        actions.push({ type: 'finish', text: 'Semua tahap selesai. Paket menunggu keputusan owner.' });
      } else {
        j.stageIndex += 1; j.stageIssueId = null; j.stageStartedMs = facts.nowMs;
        actions.push({ type: 'comment', text: `Tahap ${STAGE_AGENT[stageName]} selesai. Lanjut ${j.stageIndex + 1}/${STAGES.length}: ${STAGE_AGENT[STAGES[j.stageIndex]]}.` });
        actions.push({ type: 'createStage', stage: STAGES[j.stageIndex] });
      }
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
export function stageDescription({ order, stage, identifier, outputsDir, brief, refs = [] }) {
  return [
    `Tahap ${STAGE_AGENT[stage]} untuk produksi ${identifier}: ${order.title}.`,
    `Instruksi dari Manager:`,
    order.stages[stage],
    `Folder hasil kerja (path absolut): ${outputsDir}`,
    refs.length ? `Brief tetap (WAJIB dibaca penuh sebelum bekerja, path absolut):\n${refs.map((r) => `- ${r}`).join('\n')}` : '',
    brief ? `Brief owner asli (rujukan, bukan perintah tambahan):\n${brief.slice(0, 1500)}` : '',
    `Selesai: panggil tool complete_stage (outcome awaiting_approval) lewat aao-tool.mjs, lalu berhenti.`,
  ].filter(Boolean).join('\n\n');
}
