// owner-reply.mjs — membaca balasan owner di chat terhadap rencana Manager yang ditahan (mode tinjau). Murni, tanpa LLM:
// "setuju" -> rencana dilepas; "batal" -> dibatalkan; jawaban/catatan -> dimasukkan ke rencana. Tidak ada Manager yang dibangunkan.
const APPROVE_RE = /^(setuju|disetujui|lanjut(?:kan)?|mulai(?:kan)?|approve[d]?|gas|oke|ok|okay|silakan|silahkan|jalankan)\b[\s,.:;!-]*/i;
const CANCEL_RE = /^(batal(?:kan)?|tolak|jangan(?: lanjut)?|cancel|stop|hentikan)\b[\s,.:;!-]*/i;
export const MAX_NOTE = 500;

/** { intent: 'approve'|'cancel'|'text'|'none', note } — "setuju, maksudnya produk OpenAI" = approve + note. */
export function classifyOwnerReply(text) {
  const t = String(text ?? '').trim();
  if (!t) return { intent: 'none', note: '' };
  const a = APPROVE_RE.exec(t);
  if (a) { const rest = t.slice(a[0].length).trim(); return { intent: 'approve', note: rest.length >= 8 ? rest.slice(0, MAX_NOTE) : '' }; }
  if (CANCEL_RE.test(t)) return { intent: 'cancel', note: '' };
  return { intent: 'text', note: t.slice(0, MAX_NOTE) };
}

/** Pilih rencana yang dimaksud: yang disebut kodenya (EDU-n) di pesan, selain itu yang paling baru siap. */
export function choosePlan(plans, text) {
  if (!plans?.length) return null;
  const m = /EDU-[0-9]+/i.exec(String(text ?? ''));
  if (m) { const hit = plans.find((p) => p.identifier.toUpperCase() === m[0].toUpperCase()); if (hit) return hit; }
  return [...plans].sort((a, b) => (b.readyMs ?? 0) - (a.readyMs ?? 0))[0];
}

/**
 * @param {object} p
 * @param {string} p.text         pesan owner
 * @param {{identifier:string, readyMs?:number}[]} p.plans   rencana yang ditahan dan siap
 * @param {(identifier:string)=>boolean} p.hasQuestions       apakah rencana itu punya pertanyaan untuk owner yang belum dijawab
 * @returns {null | {action:'approve'|'cancel'|'note', identifier:string, note:string, others:string[]}}  null = bukan urusan rencana (lanjut ke chat biasa)
 */
export function decidePlanAction({ text, plans, hasQuestions = () => false }) {
  const plan = choosePlan(plans, text);
  if (!plan) return null;
  const cls = classifyOwnerReply(text);
  const others = plans.filter((p) => p.identifier !== plan.identifier).map((p) => p.identifier);
  if (cls.intent === 'approve') return { action: 'approve', identifier: plan.identifier, note: cls.note, others };
  if (cls.intent === 'cancel') return { action: 'cancel', identifier: plan.identifier, note: '', others };
  // teks bebas hanya dianggap jawaban bila rencana punya pertanyaan, pesan bukan pertanyaan, dan cukup pendek; selain itu ke chat biasa
  const t = String(text ?? '');
  if (cls.intent === 'text' && hasQuestions(plan.identifier) && !t.includes('?') && t.length <= 400) return { action: 'note', identifier: plan.identifier, note: cls.note, others };
  return null;
}

export function planReplyText({ action, identifier, note = '', others = [] }) {
  const more = others.length ? ` (rencana lain yang masih menunggu: ${others.join(', ')}; sebut kodenya bila maksud Anda yang itu)` : '';
  if (action === 'approve') return `Rencana ${identifier} disetujui${note ? ' dengan catatan Anda' : ''}. Orkestrator melepasnya dalam beberapa detik; Researcher mulai begitu giliran tiba.${more}`;
  if (action === 'cancel') return `Rencana ${identifier} dibatalkan. Tidak ada kuota agent yang terpakai.${more}`;
  return `Jawaban Anda dicatat ke rencana ${identifier}; Researcher akan membacanya. Ketik "setuju" untuk memulai atau "batal" untuk membatalkan.${more}`;
}

const PAUSE_RE = /^(jeda|pause|istirahat(?:kan)?|hentikan sementara|tahan semua)\b/i;
const RESUME_RE = /^(kerja lagi|lanjut(?:kan)? (?:kerja|pekerjaan|kerjaan|produksi|proses|semua)|resume|teruskan(?: kerja| pekerjaan)?|aktifkan lagi|mulai kerja lagi)\b/i;
/** "lanjutkan" polos: untuk rencana bila ada rencana menunggu, selain itu (tidak ada rencana) berarti melanjutkan pekerjaan yang dijeda. */
export const isBareContinue = (text) => /^(lanjut(?:kan)?|teruskan)\s*[.!]*$/i.test(String(text ?? "").trim());
/** Perintah kendali pekerjaan di chat: 'pause' | 'resume' | null. Kata sengaja khusus agar tidak bentrok dengan "setuju/lanjutkan" untuk rencana. */
export function classifyControl(text) {
  const t = String(text ?? '').trim();
  if (PAUSE_RE.test(t)) return 'pause';
  if (RESUME_RE.test(t)) return 'resume';
  return null;
}
