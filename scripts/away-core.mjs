// away-core.mjs — keputusan murni "mode pergi" (owner menutup perangkat sementara TANPA memakai token model), masa pemanasan setelah boot, dan pemutus token. Tanpa I/O.
export const WARMUP_MS = 15 * 60_000;          // kantor otonom tidak membuat brief baru selama ini setelah sistem dinyalakan
export const RESUME_HOLD_MS = 2 * 60_000;      // setelah boot/bangun dari tidur: tidak ada tahap baru sampai Paperclip dan jaringan stabil
export const TOKEN_BREAKER = Object.freeze({ windowMs: 30 * 60_000, maxFails: 8 }); // >= maxFails kegagalan/percobaan-ulang tahap dalam windowMs => jeda otomatis

/** Catatan mode pergi. hours <= 0 / tidak diberi = tanpa batas (sampai owner memanggil "off"). power: 'shutdown' | 'sleep' | null (aksi Windows setelah aman). */
export function makeAway({ nowMs, hours = 0, note = '', power = null }) {
  const h = Number(hours);
  return { since: nowMs, until: Number.isFinite(h) && h > 0 ? nowMs + Math.round(h * 3_600_000) : null, note: String(note).slice(0, 200), power: ['shutdown', 'sleep'].includes(power) ? power : null };
}
/** Mode pergi berbatas waktu yang sudah lewat: orkestrator melanjutkan sendiri (mis. perangkat dinyalakan lagi sesudah batas). */
export const awayExpired = (away, nowMs) => !!away && away.until != null && nowMs >= away.until;
/** Setelah proses orkestrator dinyalakan (boot/mati listrik/restart) beri waktu sistem stabil sebelum kantor otonom menyusun brief baru (yang memakai token). */
export const inWarmup = (bootMs, nowMs, warmMs = WARMUP_MS) => nowMs - bootMs < warmMs;
/** Tahan tahap baru sebentar setelah proses dinyalakan atau bangun dari tidur (Paperclip memulihkan database, jaringan belum stabil). */
export const resumeHold = ({ bootMs, resumeUntilMs = 0, nowMs, holdMs = RESUME_HOLD_MS }) => nowMs - bootMs < holdMs || nowMs < resumeUntilMs;

/** Pemutus token: catat kegagalan; true bila sudah terlalu banyak dalam jendela waktu. Mengembalikan { fails: daftar baru, trip }. */
export function noteFailure(fails, nowMs, cfg = TOKEN_BREAKER) {
  const keep = [...(fails ?? []).filter((t) => nowMs - t < cfg.windowMs), nowMs];
  return { fails: keep, trip: keep.length >= cfg.maxFails };
}

/** Ringkasan untuk tombol/spanduk di UI. launcher = isi workspace/launcher-status.json. */
export function awayView({ away = null, paused = false, autoPause = null, launcher = null }) {
  const waiting = Array.isArray(launcher?.waiting) ? launcher.waiting : [];
  const shutting = launcher?.shutting === true;
  const safeToClose = shutting && launcher?.safeToClose === true;
  let phase = 'normal';
  if (away && shutting) phase = safeToClose ? 'aman' : 'menguras';
  else if (away) phase = 'pergi';
  else if (autoPause) phase = 'jeda-otomatis';
  else if (paused) phase = 'jeda';
  return { phase, waiting, safeToClose, away, autoPause };
}
