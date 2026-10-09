// status.mjs — instant, deterministic answers to "how far is the production?" (no LLM, no tokens).
// Pure functions + one gatherer with injected I/O so everything is unit-testable.
import { STAGES, STAGE_AGENT } from '../../scripts/orchestrator-core.mjs';

/** Short owner questions about progress. Long messages or "manager:" prefix go to the Manager instead. */
export function isStatusQuestion(text) {
  const t = String(text ?? '').trim();
  if (!t || t.length > 220 || /^manager\s*:/i.test(t)) return false;
  if (/\b(buat|tulis|ubah|ganti|tambah|hapus|kirim|jalankan|mulai|riset|desain)\b/i.test(t) && !/\?/.test(t)) return false;
  return /(sampai mana|sudah sampai|progres+s?|progress|status|sedang apa|lagi apa|kondisi|perkembangan|update(?:an)?|sudah selesai|kapan selesai|bagaimana (hasil|kerja))/i.test(t);
}

/** Last visible activity from a Paperclip run log (the `content` field: JSON lines of {ts, chunk}). */
export function lastActivityFromLog(content) {
  let last = null;
  for (const line of String(content ?? '').split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    let i = null; try { i = JSON.parse(o.chunk); } catch { continue; }
    const part = i?.part;
    if (part?.type === 'tool' || i?.type === 'tool_use') {
      const inp = part?.state?.input ?? {};
      const arg = String(inp.filePath ?? inp.path ?? inp.pattern ?? inp.command ?? inp.url ?? '').replace(/\s+/g, ' ');
      last = { ts: Date.parse(o.ts), label: `${part?.tool ?? 'alat'}${arg ? ' ' + arg.slice(0, 70) : ''}` };
    } else if (i?.type === 'text' || part?.type === 'text') {
      last = { ts: Date.parse(o.ts), label: 'menulis jawaban' };
    }
  }
  return last && Number.isFinite(last.ts) ? last : null;
}

const hhmm = (ms) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
const dur = (ms) => (ms < 90_000 ? `${Math.max(1, Math.round(ms / 1000))} detik` : `${Math.round(ms / 60_000)} menit`);

/**
 * facts: { nowMs, job, agents:[{name,status,model}], net:{offline,since}|null, activity:{ts,label}|null,
 *          lastBlockLine:string|null, queue:number }
 */
export function buildStatusText(f) {
  const lines = [`📊 Status ${hhmm(f.nowMs)}`];
  const j = f.job;
  if (!j) {
    lines.push('🏭 Tidak ada produksi berjalan.' + (f.queue ? ` Antrean brief: ${f.queue}.` : ''));
    if (f.lastJob?.phase === 'done') lines.push(`✔ Produksi terakhir ${f.lastJob.identifier} SELESAI: paket menunggu keputusanmu (tab Approval, klik kotak approval di meja Manager).`);
    else if (f.lastJob?.phase === 'blocked') lines.push(`⚠ Produksi terakhir ${f.lastJob.identifier} terblokir; lihat log orkestrator atau tanyakan "manager:".`);
  } else {
    const idx = j.stageIndex;
    const stageName = idx >= 0 ? STAGE_AGENT[STAGES[idx]] : null;
    if (j.phase === 'planning') lines.push(`🏭 Produksi ${j.identifier}: Manager sedang menyusun work order.`);
    else if (j.phase === 'running') lines.push(`🏭 Produksi ${j.identifier} · tahap ${idx + 1}/${STAGES.length} ${stageName}${j.stageStartedMs ? ` · berjalan ${dur(f.nowMs - j.stageStartedMs)} (sejak ${hhmm(j.stageStartedMs)})` : ''}`);
    else if (j.phase === 'done') lines.push(`🏭 Produksi ${j.identifier}: SELESAI. Paket menunggu keputusanmu.`);
    else if (j.phase === 'blocked') lines.push(`🏭 Produksi ${j.identifier}: DIBLOKIR di tahap ${stageName ?? 'perencanaan'}.${f.lastBlockLine ? ' ' + f.lastBlockLine : ''}`);
    if (j.phase !== 'planning') {
      const done = j.phase === 'done' ? STAGES.length : Math.max(0, idx);
      const doneNames = STAGES.slice(0, done).map((s) => STAGE_AGENT[s]);
      lines.push(`✔ Selesai: Manager (work order)${doneNames.length ? ', ' + doneNames.join(', ') : ''}`);
    }
    if (j.phase === 'running' && f.activity) lines.push(`⏳ ${stageName} terakhir: ${f.activity.label} (${dur(f.nowMs - f.activity.ts)} lalu)`);
    if (f.queue) lines.push(`📥 Antrean brief: ${f.queue}`);
  }
  lines.push(f.net?.offline ? `🔌 Internet: TERPUTUS${f.net.since ? ' sejak ' + hhmm(f.net.since) : ''}; pekerjaan ditahan, lanjut otomatis saat online.` : '🌐 Internet: online');
  const busy = (f.agents ?? []).filter((a) => a.status !== 'idle');
  const idle = (f.agents ?? []).filter((a) => a.status === 'idle').map((a) => a.name);
  if (f.agents?.length) lines.push(`👥 ${busy.length ? busy.map((a) => `${a.name} ${a.status}${a.model ? ' (' + a.model.split('/').pop() + ')' : ''}`).join(' · ') : 'Semua agent idle'}${idle.length && busy.length ? ' · idle: ' + idle.join(', ') : ''}`);
  lines.push('ℹ Jawaban ini dibuat dari data nyata tanpa memakai kuota. Untuk bertanya ke Manager sendiri, awali dengan "manager:".');
  return lines.join('\n');
}

/** Timeline of what an agent did in a run: newest last, at most `limit` entries. Same log format as lastActivityFromLog. */
export function activityTimeline(content, limit = 30) {
  const out = [];
  for (const line of String(content ?? '').split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    let i = null; try { i = JSON.parse(o.chunk); } catch { continue; }
    const ts = Date.parse(o.ts);
    if (!Number.isFinite(ts)) continue;
    const part = i?.part;
    if (part?.type === 'tool' || i?.type === 'tool_use') {
      const inp = part?.state?.input ?? {};
      const arg = String(inp.filePath ?? inp.path ?? inp.pattern ?? inp.command ?? inp.url ?? '').replace(/\s+/g, ' ');
      out.push({ ts, kind: 'tool', tool: part?.tool ?? 'alat', label: arg.slice(0, 140), status: part?.state?.status ?? null });
    } else if (i?.type === 'text' || part?.type === 'text') {
      const txt = String(part?.text ?? i?.text ?? '').replace(/\s+/g, ' ').trim();
      if (txt) out.push({ ts, kind: 'text', tool: 'jawaban', label: txt.slice(0, 160), status: null });
    }
  }
  return out.slice(-limit);
}
