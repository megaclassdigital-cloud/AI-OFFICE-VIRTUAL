// guards.mjs — pagar keamanan autoposter (ADR-0005). KODE MURNI, dites: tidak ada klik ke platform sebelum semua pagar ini lolos.
// Prinsip: runner tidak berimprovisasi; dry-run TIDAK PERNAH menekan tombol kirim; mode live hanya bila owner menyalakannya per platform.

// Kebijakan saat ini (keputusan owner 16 Okt 2026): konten yang SUDAH di-approve langsung diposting kapan pun, dengan JEDA cooldownHours yang dihitung
// dari waktu posting terakhir pada platform itu. Tidak ada jendela jam; batas harian hanya jaring pengaman. autopostSince: approval yang diputuskan
// SEBELUM waktu ini tidak pernah diposting otomatis (konten lama yang sudah approved sebelum fitur ini ada).
export const DEFAULT_AUTOPOST_SETTINGS = Object.freeze({
  paused: false,                          // kill switch global: true = tidak ada posting sama sekali
  cooldownHours: 3,                       // jeda antar posting per platform, dari posting terakhir
  autopostSince: null,                    // ISO; null = tidak ada konten yang boleh diposting otomatis
  retryAfterMinutes: 30,                  // jeda coba ulang setelah GAGAL SEBELUM terkirim (tidak pernah untuk tidak_pasti)
  maxFailures: 3,                         // setelah sekian kegagalan, konten menunggu pemeriksaan owner
  platforms: {
    instagram: { live: false, maxPerDay: 6 },
    tiktok: { live: false, maxPerDay: 6 },
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

/** Jeda (menit) antar posting untuk satu platform: minGapMinutes platform bila ada, selain itu cooldownHours global. */
export const gapMinutes = (settings, platform) => {
  const s = mergeAutopostSettings(settings);
  return s.platforms[platform]?.minGapMinutes ?? s.cooldownHours * 60;
};

/** Hitung mundur: kapan platform boleh memposting lagi, dihitung dari posting live TERAKHIR. */
export function cooldownStatus(ledger, platform, settings, nowMs) {
  const last = postingsToday(ledger, platform, nowMs).lastMs;
  const gap = gapMinutes(settings, platform) * 60_000;
  if (last == null) return { lastPostAt: null, nextAllowedAt: null, remainingMs: 0, ready: true };
  const next = last + gap; const remaining = Math.max(0, next - nowMs);
  return { lastPostAt: new Date(last).toISOString(), nextAllowedAt: new Date(next).toISOString(), remainingMs: remaining, ready: remaining === 0 };
}

/** Format sisa waktu untuk manusia: "2 jam 14 menit", "siap". */
export function formatRemaining(ms) {
  if (ms <= 0) return 'siap';
  const m = Math.ceil(ms / 60_000); const h = Math.floor(m / 60); const mm = m % 60;
  return h ? `${h} jam${mm ? ` ${mm} menit` : ''}` : `${mm} menit`;
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
  const fails = (ledger ?? []).filter((e) => e.mode === 'live' && e.content === content && e.platform === platform && e.status === 'gagal');
  if (fails.length >= s.maxFailures) reasons.push(`gagal ${fails.length}x sebelum terkirim; butuh pemeriksaan owner`);
  else if (fails.length) {
    const wait = Math.max(...fails.map((e) => Date.parse(e.at))) + s.retryAfterMinutes * 60_000 - nowMs;
    if (wait > 0) reasons.push(`menunggu coba ulang setelah gagal (sisa ${formatRemaining(wait)})`);
  }
  const t = postingsToday(ledger, platform, nowMs, utcOffsetMinutes);
  if (t.count >= (p.maxPerDay ?? 1)) reasons.push(`batas harian ${platform} tercapai (${t.count}/${p.maxPerDay})`);
  const gap = gapMinutes(s, platform);
  if (t.lastMs != null && nowMs - t.lastMs < gap * 60_000) reasons.push(`jeda ${Math.round(gap / 60 * 10) / 10} jam antar posting belum terpenuhi (sisa ${formatRemaining(t.lastMs + gap * 60_000 - nowMs)})`);
  return { ok: reasons.length === 0, reasons };
}

/** Tombol yang mengirim/mempublikasikan (multi-bahasa). Dalam dry-run, mengkliknya adalah kesalahan fatal. */
export const FINAL_ACTION_RE = /^\s*(share|bagikan|post|posting|publish|publikasikan|kirim|upload|unggah)(\s+(now|sekarang|anyway))?\s*$/i;

/** Pagar klik: dalam dry-run menolak tombol final; dalam live hanya mengizinkan bila allowFinal diberikan eksplisit. Melempar galat bila dilanggar. */
export function assertClickAllowed(label, { dryRun, allowFinal = false }) {
  const isFinal = FINAL_ACTION_RE.test(String(label ?? ''));
  if (isFinal && (dryRun || !allowFinal)) throw new Error(`DITOLAK: klik tombol final "${label}" tidak diizinkan (${dryRun ? 'dry-run' : 'tanpa izin eksplisit'})`);
  return true;
}
