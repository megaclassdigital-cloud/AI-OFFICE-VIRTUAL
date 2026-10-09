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
  for (const fj of f.followers ?? []) {
    const where = fj.phase === 'planning' ? 'mulai tahap 1' : `tahap ${fj.stageIndex + 1}/${STAGES.length} ${STAGE_AGENT[STAGES[fj.stageIndex]]}${fj.laneWait && STAGES[fj.stageIndex + 1] ? ` (selesai, menunggu ${STAGE_AGENT[STAGES[fj.stageIndex + 1]]} bebas)` : ''}`;
    lines.push(`🏭 ${fj.identifier}: ${where} (jalur paralel di belakang ${f.job?.identifier ?? 'konten terdepan'})`);
  }
  for (const p of f.pending ?? []) lines.push(p.ready ? `📝 ${p.identifier}: rencana Manager siap, menunggu giliran.` : `📝 ${p.identifier}: Manager sedang menyusun rencana (paralel, tidak mengganggu job yang berjalan).`);
  if (f.paused) lines.push(`⏸ DIJEDA owner: tidak ada pekerjaan baru dan jam tahap dibekukan. Agent yang masih menyelesaikan run: ${(f.agents ?? []).filter((a) => a.status === 'running').map((a) => a.name).join(', ') || 'tidak ada (aman menutup aplikasi)'}. Ketik "kerja lagi" untuk melanjutkan.`.replace('\u00ad', ''));
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

/** Pertanyaan owner tentang HASIL RISET (mis. "yang sudah ditemukan itu untuk 1 konten atau beberapa?"): dijawab dari berkas nyata, tanpa LLM. */
export function isResearchQuestion(text) {
  const t = String(text ?? '').trim();
  if (!t || t.length > 600 || /^manager\s*:/i.test(t)) return false;
  if (!/(\?|apakah|berapa|sudah)/i.test(t)) return false;
  const about = /(researcher|riset|peneliti|berita|kandidat|temuan|ditemukan|hasil cari)/i.test(t);
  const unit = /(konten|carousel|topik|kandidat|beberapa|berapa|copywriter|konsep)/i.test(t);
  const command = /\b(buat|tulis|ubah|ganti|tambah|hapus|kirim|jalankan|mulai)\b/i.test(t) && !/\?/.test(t);
  return about && unit && !command;
}

/** Jawaban dari berkas run terakhir. data: { identifier, research, verification, carousel } (semua boleh null). */
export function buildResearchText(data) {
  const { identifier, research, verification, carousel } = data ?? {};
  const cands = research?.candidates ?? [];
  if (!cands.length) return 'Belum ada hasil riset yang tersimpan (folder run belum berisi research-output.json). Minta produksi baru lewat tombol Produksi atau beri arahan topik.';
  const res = verification?.results ?? [];
  const ok = res.filter((r) => r.status === 'verified').length;
  const lines = [`Hasil riset terakhir (${identifier ?? 'run terakhir'}): ${cands.length} kandidat berita${res.length ? `, ${ok} lolos verifikasi, ${res.length - ok} ditolak/ragu` : ' (belum diverifikasi)'}.`];
  lines.push(...cands.slice(0, 8).map((c) => `- ${c.id}: ${String(c.title).slice(0, 90)}${(res.find((r) => r.candidateId === c.id)?.status ?? '') ? ` [${res.find((r) => r.candidateId === c.id).status}]` : ''}`));
  lines.push('Satu produksi menghasilkan SATU carousel: Copywriter merangkai satu topik/angle dari kandidat terverifikasi, bukan satu carousel per kandidat.' + (carousel?.topic ? ` Carousel run ini: "${String(carousel.topic).slice(0, 100)}" (${carousel.slides?.length ?? '?'} slide, ${carousel.sources?.length ?? '?'} sumber).` : ''));
  lines.push('Kandidat lain tidak otomatis jadi konten. Untuk beberapa konten, beri arahan satu topik per produksi (mis. "buat carousel tentang <judul kandidat>"); produksi berjalan satu per satu.');
  return lines.join('\n');
}

/**
 * Balasan instan (dari kode, tanpa LLM) saat brief masuk antrean: posisi, job yang berjalan, dan apa yang terjadi berikutnya.
 * facts: { job:{identifier,phase,stageIndex}|null, pending:[{identifier,ready}], inboxAhead:number }  (inboxAhead = brief yang sudah antre di inbox SEBELUM brief ini)
 */
export function buildBriefAck({ job = null, pending = [], inboxAhead = 0 } = {}) {
  const pos = pending.length + inboxAhead + 1;
  const running = job && !['done', 'blocked'].includes(job.phase) ? job : null;
  if (!running) {
    return pending.length || inboxAhead
      ? `Brief diterima (antrean #${pos}). Tidak ada job berjalan; brief di depan diproses lebih dulu, lalu brief ini.`
      : 'Brief diterima. Tidak ada job berjalan: orkestrator mengambilnya dalam beberapa detik dan Manager langsung menyusun rencana.';
  }
  const stage = running.stageIndex >= 0 ? STAGE_AGENT[STAGES[running.stageIndex]] : 'perencanaan';
  const base = `Brief diterima (antrean #${pos}). Job ${running.identifier} (tahap ${stage}) tetap berjalan dan tidak diganggu.`;
  if (!pending.length && !inboxAhead) return `${base} Manager mulai menyusun rencana brief ini sekarang, paralel; tahap Researcher mulai begitu giliran tiba.`;
  const ahead = pending[0] ? `Manager sedang/telah menyusun rencana untuk ${pending[0].identifier}` : 'Ada brief di depan';
  return `${base} ${ahead}; brief ini direncanakan Manager begitu slot rencana kosong, lalu menunggu giliran tahapnya.`;
}
