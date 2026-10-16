// guards.mjs — pagar keamanan autoposter (ADR-0005). KODE MURNI, dites: tidak ada klik ke platform sebelum semua pagar ini lolos.
// Prinsip: runner tidak berimprovisasi; dry-run TIDAK PERNAH menekan tombol kirim; mode live hanya bila owner menyalakannya per platform.

export const DEFAULT_AUTOPOST_SETTINGS = Object.freeze({
  paused: false,                          // kill switch global: true = tidak ada posting sama sekali
  platforms: {
    instagram: { live: false, maxPerDay: 2, minGapMinutes: 180 },
    tiktok: { live: false, maxPerDay: 2, minGapMinutes: 180 },
  },
});

export function mergeAutopostSettings(user = {}) {
  const platforms = {};
  for (const [n, d] of Object.entries(DEFAULT_AUTOPOST_SETTINGS.platforms)) platforms[n] = { ...d, ...(user.platforms?.[n] ?? {}) };
  return { ...DEFAULT_AUTOPOST_SETTINGS, ...user, platforms };
}

/** Status ledger yang berarti "jangan kirim lagi": sudah/sedang diposting atau hasilnya tidak pasti (owner harus memeriksa). */
export const BLOCKING = ['diposting', 'sedang_diposting', 'tidak_pasti'];

/** Ada catatan LIVE yang memblokir untuk konten x platform? Catatan dry-run tidak pernah memblokir. */
export function ledgerBlocks(ledger, content, platform) {
  return (ledger ?? []).find((e) => e.mode === 'live' && e.content === content && e.platform === platform && BLOCKING.includes(e.status)) ?? null;
}

/** Jumlah posting live pada hari lokal yang sama dan waktu terakhir (ms) untuk satu platform. */
export function postingsToday(ledger, platform, nowMs, utcOffsetMinutes = 420) {
  const day = (ms) => Math.floor((ms + utcOffsetMinutes * 60_000) / 86_400_000);
  const mine = (ledger ?? []).filter((e) => e.mode === 'live' && e.platform === platform && ['diposting', 'sedang_diposting', 'tidak_pasti'].includes(e.status));
  return { count: mine.filter((e) => day(Date.parse(e.at)) === day(nowMs)).length, lastMs: mine.length ? Math.max(...mine.map((e) => Date.parse(e.at))) : null };
}

/**
 * Boleh memposting LIVE? Mengembalikan { ok, reasons[] } (semua alasan penolakan, bukan hanya yang pertama).
 * approval: { approved:boolean, hashMatches:boolean } dari record approval owner (F2.2). Dry-run tidak memakai fungsi ini: ia tidak pernah mengirim.
 */
export function canPostLive({ settings, platform, ledger, content, approval, nowMs, utcOffsetMinutes = 420 }) {
  const s = mergeAutopostSettings(settings); const reasons = [];
  const p = s.platforms[platform];
  if (!p) return { ok: false, reasons: [`platform tidak dikenal: ${platform}`] };
  if (s.paused) reasons.push('kill switch aktif (paused)');
  if (p.live !== true) reasons.push(`mode live ${platform} belum dinyalakan owner`);
  if (!approval?.approved) reasons.push('konten belum di-approve owner');
  else if (approval.hashMatches !== true) reasons.push('isi konten berubah setelah approval (hash tidak cocok)');
  const dup = ledgerBlocks(ledger, content, platform);
  if (dup) reasons.push(`sudah tercatat ${dup.status} pada ${dup.at} (tidak dikirim ulang${dup.status === 'tidak_pasti' ? '; owner perlu memeriksa hasilnya' : ''})`);
  const t = postingsToday(ledger, platform, nowMs, utcOffsetMinutes);
  if (t.count >= (p.maxPerDay ?? 1)) reasons.push(`batas harian ${platform} tercapai (${t.count}/${p.maxPerDay})`);
  if (t.lastMs != null && nowMs - t.lastMs < (p.minGapMinutes ?? 0) * 60_000) reasons.push(`jeda minimum ${p.minGapMinutes} menit antar posting belum terpenuhi`);
  return { ok: reasons.length === 0, reasons };
}

/** Tombol yang mengirim/mempublikasikan (multi-bahasa). Dalam dry-run, mengkliknya adalah kesalahan fatal. */
export const FINAL_ACTION_RE = /^\s*(share|bagikan|post|posting|publish|publikasikan|kirim|upload|unggah)\s*$/i;

/** Pagar klik: dalam dry-run menolak tombol final; dalam live hanya mengizinkan bila allowFinal diberikan eksplisit. Melempar galat bila dilanggar. */
export function assertClickAllowed(label, { dryRun, allowFinal = false }) {
  const isFinal = FINAL_ACTION_RE.test(String(label ?? ''));
  if (isFinal && (dryRun || !allowFinal)) throw new Error(`DITOLAK: klik tombol final "${label}" tidak diizinkan (${dryRun ? 'dry-run' : 'tanpa izin eksplisit'})`);
  return true;
}
