// away-core.mjs — keputusan murni "mode pergi" (owner menutup perangkat sementara tanpa memakai token) dan masa pemanasan setelah boot. Tanpa I/O.
export const WARMUP_MS = 15 * 60_000;

/** Catatan mode pergi. hours <= 0 / tidak diberi = tanpa batas (sampai owner memanggil "off"). */
export function makeAway({ nowMs, hours = 0, note = '' }) {
  const h = Number(hours);
  return { since: nowMs, until: Number.isFinite(h) && h > 0 ? nowMs + Math.round(h * 3_600_000) : null, note: String(note).slice(0, 200) };
}
/** Mode pergi berbatas waktu yang sudah lewat: orkestrator melanjutkan sendiri (mis. perangkat dinyalakan lagi sesudah batas). */
export const awayExpired = (away, nowMs) => !!away && away.until != null && nowMs >= away.until;
/** Setelah proses orkestrator dinyalakan (boot/mati listrik/restart) beri waktu sistem stabil sebelum kantor otonom menyusun brief baru (yang memakai token). */
export const inWarmup = (bootMs, nowMs, warmMs = WARMUP_MS) => nowMs - bootMs < warmMs;
