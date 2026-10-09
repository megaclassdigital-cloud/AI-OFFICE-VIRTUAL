// manager-outbox.mjs — kotak keluar Manager: pesan untuk owner yang harus MUNCUL DI CHAT (rencana, pertanyaan, hasil keputusan).
// Penulis tunggal: orkestrator (JSONL, id naik). Pembaca: Office View (/api/talk/outbox) lalu dock. Tanpa LLM.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { renderAnalysisComment } from './orchestrator-core.mjs';

const NL = String.fromCharCode(10);
export const outboxFile = (dir) => path.join(dir, 'manager-outbox.jsonl');

/** Semua pesan (urut naik); baris rusak dilewati. */
export function readAllOutbox(dir) {
  const f = outboxFile(dir);
  if (!existsSync(f)) return [];
  const out = [];
  for (const line of readFileSync(f, 'utf8').split(NL)) {
    if (!line.trim()) continue;
    try { const m = JSON.parse(line); if (Number.isInteger(m.id)) out.push(m); } catch { /* baris rusak */ }
  }
  return out;
}

/** Pesan dengan id > afterId. afterId=0 (pembukaan pertama) hanya mengembalikan 10 pesan terakhir agar chat tidak banjir. */
export function readOutbox(dir, afterId = 0, firstLoad = 10) {
  const all = readAllOutbox(dir);
  return afterId > 0 ? all.filter((m) => m.id > afterId) : all.slice(-firstLoad);
}

export function appendOutbox(dir, msg, nowMs = Date.now()) {
  mkdirSync(dir, { recursive: true });
  const last = readAllOutbox(dir).at(-1)?.id ?? 0;
  const entry = { id: last + 1, at: nowMs, from: 'Manager', ...msg };
  appendFileSync(outboxFile(dir), JSON.stringify(entry) + NL, 'utf8');
  return entry;
}

const MODEL_NAME = { claude_local: 'Claude', codex_local: 'ChatGPT', gemini_local: 'Gemini', opencode_local: 'model gratis' };
/** "Manager (Claude)" — owner tahu model mana yang berbicara. */
export const speakerName = (adapterType) => (MODEL_NAME[adapterType] ? `Manager (${MODEL_NAME[adapterType]})` : 'Manager');

/** Pesan rencana untuk chat: analisis Manager, ringkasannya, dan cara membalas. needsApproval = mode tinjau (rencana ditahan). */
export function buildPlanMessage({ identifier, order, managerSummary = '', needsApproval = false, from = 'Manager' }) {
  const lines = [`[${identifier}] ${renderAnalysisComment(order)}`];
  if (managerSummary) lines.push(`Ringkasan Manager: ${managerSummary}`);
  lines.push(needsApproval
    ? 'Balas di chat ini: "setuju" untuk memulai, "batal" untuk membatalkan, atau tulis jawaban/catatan Anda (dicatat ke rencana tanpa membangkitkan Manager lagi; jawaban dan "setuju" bisa digabung).'
    : 'Rencana ini langsung berjalan; bila ada yang salah, tolak paketnya nanti dan Manager mengarahkan revisinya.');
  return { kind: 'plan', identifier, from, text: lines.join(NL + NL), needsApproval };
}
