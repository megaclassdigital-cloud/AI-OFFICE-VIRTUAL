// Guard pemakaian deterministik (F1.0f). Generik untuk semua division.
//
// Budget Paperclip tidak melindungi apa pun karena adapter langganan selalu melaporkan billed_cents = 0
// (docs/spike/report.md). Guard ini membatasi lewat hal yang benar-benar terukur: jumlah run dan durasi
// per agent per hari. Modul ini murni (tanpa I/O) supaya bisa diuji dengan run tiruan.

export const DEFAULT_LIMITS = Object.freeze({
  maxRunsPerAgentPerDay: 6,
  maxMinutesPerAgentPerDay: 60,
  timezoneOffsetMinutes: 420, // WIB
});

/** Validasi + isi default. Nilai tidak valid melempar galat (jangan diam-diam longgar). */
export function normalizeLimits(raw = {}) {
  const l = { ...DEFAULT_LIMITS, ...raw };
  for (const k of ['maxRunsPerAgentPerDay', 'maxMinutesPerAgentPerDay']) {
    if (!Number.isFinite(l[k]) || l[k] <= 0) throw new Error(`limits.${k} harus angka > 0`);
  }
  // perAgent: batas khusus per NAMA agent (mis. Manager lebih longgar). Divalidasi sama ketatnya.
  if (l.perAgent !== undefined) {
    if (!l.perAgent || typeof l.perAgent !== 'object' || Array.isArray(l.perAgent)) throw new Error('limits.perAgent harus objek');
    for (const [name, o] of Object.entries(l.perAgent)) {
      for (const [k, v] of Object.entries(o ?? {})) {
        if (!['maxRunsPerAgentPerDay', 'maxMinutesPerAgentPerDay'].includes(k)) throw new Error(`limits.perAgent.${name}.${k} tidak dikenal`);
        if (!Number.isFinite(v) || v <= 0) throw new Error(`limits.perAgent.${name}.${k} harus angka > 0`);
      }
    }
  }
  if (!Number.isFinite(l.timezoneOffsetMinutes) || Math.abs(l.timezoneOffsetMinutes) > 14 * 60) {
    throw new Error('limits.timezoneOffsetMinutes tidak valid');
  }
  return l;
}

/** Awal hari lokal (ms epoch) untuk waktu `nowMs` pada zona `offsetMinutes`. */
export function startOfLocalDay(nowMs, offsetMinutes) {
  const shifted = nowMs + offsetMinutes * 60_000;
  return Math.floor(shifted / 86_400_000) * 86_400_000 - offsetMinutes * 60_000;
}

/**
 * Ringkas run per agent untuk hari ini.
 * @param runs  [{ agentId, startedAt, finishedAt? }]  (ISO string). Run tanpa startedAt diabaikan.
 * @returns Map agentId -> { runs, minutes }
 */
/** Satu run tidak mungkin memakai lebih dari ini (timeout adapter 10 mnt + margin). Run yatim (tanpa finishedAt, sisa shutdown/lag/tidur) tidak boleh dihitung ratusan menit. */
export const MAX_RUN_MINUTES = 15;

export function summarizeRuns(runs, nowMs, limits) {
  const dayStart = startOfLocalDay(nowMs, limits.timezoneOffsetMinutes);
  const out = new Map();
  for (const r of runs) {
    // Run yang dibatalkan sebelum berjalan (mis. agent sedang di-pause) tidak memakai kuota model: tidak dihitung.
    if (r.status === 'cancelled') continue;
    const s = Date.parse(r.startedAt ?? '');
    if (!Number.isFinite(s) || s < dayStart || s > nowMs) continue;
    const f = r.finishedAt ? Date.parse(r.finishedAt) : nowMs; // run berjalan dihitung sampai sekarang
    const end = Number.isFinite(f) ? Math.min(Math.max(f, s), nowMs) : nowMs;
    const cur = out.get(r.agentId) ?? { runs: 0, minutes: 0 };
    cur.runs += 1;
    cur.minutes += Math.min((end - s) / 60_000, MAX_RUN_MINUTES);
    out.set(r.agentId, cur);
  }
  return out;
}

/** Agent yang melewati batas. Batas "tercapai" (>=) sudah cukup untuk pause: run berikutnya tidak boleh mulai. */
export function evaluate(summary, limits, limitsFor = () => limits) {
  const violations = [];
  for (const [agentId, u] of summary) {
    const lim = limitsFor(agentId);
    const reasons = [];
    if (u.runs >= lim.maxRunsPerAgentPerDay) reasons.push(`run ${u.runs}/${lim.maxRunsPerAgentPerDay}`);
    if (u.minutes >= lim.maxMinutesPerAgentPerDay) {
      reasons.push(`durasi ${u.minutes.toFixed(1)}/${lim.maxMinutesPerAgentPerDay} menit`);
    }
    if (reasons.length) violations.push({ agentId, reasons, runs: u.runs, minutes: Number(u.minutes.toFixed(2)) });
  }
  return violations;
}

/**
 * Jalankan guard: hitung, pause yang melanggar, catat audit.
 * deps: { listRuns(companyId), pauseAgent(agentId, companyId), getAgent(agentId, companyId), audit(entry) }
 * Idempoten: agent yang sudah paused tidak di-pause ulang dan tidak dicatat dua kali.
 */
export async function enforce({ companyId, limitsRaw, nowMs = Date.now(), deps }) {
  const limits = normalizeLimits(limitsRaw);
  const runs = await deps.listRuns(companyId);
  const summary = summarizeRuns(runs, nowMs, limits);
  // Batas efektif per agent: default + override berdasarkan nama (perAgent).
  const effective = new Map();
  for (const agentId of summary.keys()) {
    const ag = await deps.getAgent(agentId, companyId);
    effective.set(agentId, { ...limits, ...(limits.perAgent?.[ag?.name] ?? {}) });
  }
  const violations = evaluate(summary, limits, (id) => effective.get(id) ?? limits);
  const paused = [];
  for (const v of violations) {
    const agent = await deps.getAgent(v.agentId, companyId);
    if (!agent || agent.status === 'paused' || agent.status === 'terminated') continue;
    await deps.pauseAgent(v.agentId, companyId);
    await deps.audit({
      companyId,
      message: `Guard pemakaian mem-pause agent ${agent.name ?? v.agentId}: ${v.reasons.join('; ')}`,
      entityType: 'agent',
      entityId: v.agentId,
      metadata: { ...v, limits },
    });
    paused.push(v.agentId);
  }
  return { checked: runs.length, violations, paused };
}
