// sustain-core.mjs — keputusan pemulihan mandiri (kantor tetap bekerja tanpa dipantau). Murni: tanpa I/O, waktu dioper.
// Tiga kemampuan: (1) mencoba ulang tahap yang terblokir karena gangguan INFRASTRUKTUR (bukan karena mutu), (2) membersihkan status "error" basi pada agen
// yang tidak sedang bekerja, (3) bila gambar asli tak kunjung bisa diambil pada konten otomatis, kembali ke Designer untuk desain tanpa gambar itu.
const MIN = 60_000; const HOUR = 60 * MIN;

/** Penyebab gangguan infrastruktur (layak dicoba ulang). Penolakan mutu/QA/validasi TIDAK termasuk. */
export const INFRA_RE = /Process lost|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|timed out|timeout|Adapter failed|adapter_failed|claude_auth_required|rate.?limit|\b(?:429|502|503|504)\b|overloaded|plugin|tool tidak terdaftar|jaringan|network|child pid/i;
export const isInfraBlock = (reason) => INFRA_RE.test(String(reason ?? ''));

export const SUSTAIN_DEFAULTS = Object.freeze({
  autoRetryMax: 2,              // percobaan ulang otomatis per job
  autoRetryWindowHours: 3,      // hanya untuk blokir yang baru terjadi
  autoRetryAfterMinutes: 3,     // beri Paperclip/plugin waktu pulih dulu
  healEveryMinutes: 3,          // sapuan status error agen
  healMinErrorMinutes: 4,       // error harus sudah setua ini (jangan menyapu yang baru saja gagal)
  holdFallbackMinutes: 30,      // gambar asli tak kunjung ada pada konten otomatis => desain tanpa gambar itu
  holdFallbackMax: 2,           // maksimal putaran kembali ke Designer karena gambar
});

/**
 * Apakah job terblokir ini dicoba ulang sekarang?
 * ctx: { job (entri riwayat), nowMs, paperclipOk, anotherActive:boolean, settings }
 */
export function decideAutoRetry({ job, nowMs, paperclipOk, anotherActive, settings = {} }) {
  const s = { ...SUSTAIN_DEFAULTS, ...settings };
  if (!job || job.phase !== 'blocked') return { retry: false, code: 'bukan-terblokir' };
  if (!paperclipOk) return { retry: false, code: 'paperclip-belum-sehat' };
  if (anotherActive) return { retry: false, code: 'ada-job-aktif' };
  if (!(job.stageIndex >= 0)) return { retry: false, code: 'belum-ada-tahap' };
  if (!isInfraBlock(job.blockReason)) return { retry: false, code: 'bukan-infrastruktur', reason: job.blockReason ?? null };
  if ((job.autoRetries ?? 0) >= s.autoRetryMax) return { retry: false, code: 'jatah-habis' };
  const ended = job.endedMs ?? 0;
  if (!ended || nowMs - ended > s.autoRetryWindowHours * HOUR) return { retry: false, code: 'terlalu-lama' };
  if (nowMs - ended < s.autoRetryAfterMinutes * MIN) return { retry: false, code: 'tunggu-pulih', waitMs: s.autoRetryAfterMinutes * MIN - (nowMs - ended) };
  return { retry: true, code: 'coba-ulang', attempt: (job.autoRetries ?? 0) + 1 };
}

/**
 * Agen berstatus "error" yang aman dipulihkan (resume): tidak sedang dipegang tahap aktif, errornya sudah cukup lama.
 * agents: [{ id, name, status, updatedAt|lastHeartbeatAt }]; activeAgentName: agen tahap yang sedang berjalan (tidak disentuh).
 */
export function agentsToHeal({ agents, activeAgentName, nowMs, settings = {} }) {
  const s = { ...SUSTAIN_DEFAULTS, ...settings };
  return (agents ?? []).filter((a) => {
    if (a.status !== 'error' || a.name === activeAgentName) return false;
    const t = Date.parse(a.lastHeartbeatAt ?? a.updatedAt ?? '') || 0;
    return !t || nowMs - t >= s.healMinErrorMinutes * MIN;
  });
}

/** Gambar asli tak kunjung bisa diambil: kembali ke Designer? Hanya konten otomatis, setelah menunggu cukup lama, dengan jatah putaran. */
export function holdFallbackDecision({ auto, sinceMs, nowMs, rounds = 0, settings = {} }) {
  const s = { ...SUSTAIN_DEFAULTS, ...settings };
  if (!auto) return { fallback: false, code: 'bukan-otomatis' };
  if (rounds >= s.holdFallbackMax) return { fallback: false, code: 'jatah-habis' };
  if (!sinceMs || nowMs - sinceMs < s.holdFallbackMinutes * MIN) return { fallback: false, code: 'belum-waktunya' };
  return { fallback: true, code: 'desain-tanpa-gambar' };
}

/** Umpan balik untuk Designer saat gambar tak tersedia. */
export function fallbackFeedback(missing, minutes) {
  const list = (missing ?? []).map((m) => `- ${m.file}${m.reason ? ` (${String(m.reason).slice(0, 100)})` : ''}`).join('\n');
  return `Gambar asli berikut TIDAK bisa diambil setelah ±${Math.round(minutes)} menit dan tidak akan tersedia:\n${list}\n` +
    'Tulis ulang carousel-design.json TANPA gambar itu: pakai template yang tidak memakai slot gambar (angka besar, kutipan, poin, perbandingan, ajakan), atau aset tetap brand kit (logo EdukasiAI). ' +
    'Hapus entri itu dari asset-requests.json. Jangan mengganti dengan gambar lain yang tidak terverifikasi, dan jangan memakai placeholder.';
}
