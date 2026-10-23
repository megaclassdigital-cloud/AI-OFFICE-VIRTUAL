// sustain-core.mjs — keputusan pemulihan mandiri (kantor tetap bekerja tanpa dipantau). Murni: tanpa I/O, waktu dioper.
// Tiga kemampuan: (1) mencoba ulang tahap yang terblokir karena gangguan INFRASTRUKTUR (bukan karena mutu), (2) membersihkan status "error" basi pada agen
// yang tidak sedang bekerja, (3) bila gambar asli tak kunjung bisa diambil pada konten otomatis, kembali ke Designer untuk desain tanpa gambar itu.
const MIN = 60_000; const HOUR = 60 * MIN;

/** Penyebab gangguan infrastruktur (layak dicoba ulang). Penolakan mutu/QA/validasi TIDAK termasuk. */
export const INFRA_RE = /Process lost|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|timed out|timeout|Adapter failed|adapter_failed|claude_auth_required|rate.?limit|\b(?:429|502|503|504)\b|overloaded|plugin|tool tidak terdaftar|jaringan|network|child pid|exceeded your current quota|quota/i;
export const isInfraBlock = (reason) => INFRA_RE.test(String(reason ?? '')) || SESSION_RESET_RE.test(String(reason ?? ''));
/** Sesi model lama tidak bisa dilanjutkan (mis. opencode: "Requests ending with a model turn are not supported"): ulang TANPA reset sesi akan gagal terus. */
export const SESSION_RESET_RE = /ending with a model turn|cannot resume|session (?:not found|expired|invalid)|invalid session/i;
export const needsSessionReset = (reason) => SESSION_RESET_RE.test(String(reason ?? ''));

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
export function decideAutoRetry({ job, nowMs, paperclipOk, anotherActive, settings = {}, agentEntryNow = null }) {
  const s = { ...SUSTAIN_DEFAULTS, ...settings };
  if (!job || job.phase !== 'blocked') return { retry: false, code: 'bukan-terblokir' };
  if (!paperclipOk) return { retry: false, code: 'paperclip-belum-sehat' };
  if (anotherActive) return { retry: false, code: 'ada-job-aktif' };
  if (!(job.stageIndex >= 0)) return { retry: false, code: 'belum-ada-tahap' };
  if (!isInfraBlock(job.blockReason)) return { retry: false, code: 'bukan-infrastruktur', reason: job.blockReason ?? null };
  const quotaBlock = /quota|exceeded your current/i.test(String(job.blockReason ?? ''));
  const modelChanged = !!(job.blockAgentEntry && agentEntryNow && agentEntryNow !== job.blockAgentEntry);
  if ((job.autoRetries ?? 0) >= s.autoRetryMax && !(quotaBlock && modelChanged)) return { retry: false, code: 'jatah-habis' };
  // Kuota model habis: mengulang SEBELUM failover memindah model hanya membuang run dan membuat agen 'sibuk' sehingga failover tidak bisa berpindah. Tunggu model berganti.
  if (/quota|exceeded your current/i.test(String(job.blockReason ?? ''))) {
    if (job.blockAgentEntry && agentEntryNow && agentEntryNow === job.blockAgentEntry) return { retry: false, code: 'tunggu-failover' };
    if (!job.blockAgentEntry && nowMs - (job.endedMs ?? 0) < 20 * MIN) return { retry: false, code: 'tunggu-failover' };
  }
  const ended = job.endedMs ?? 0;
  if (!ended || nowMs - ended > (quotaBlock ? 24 : s.autoRetryWindowHours) * HOUR) return { retry: false, code: 'terlalu-lama' };
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

/**
 * Finalisasi (finalize-production) gagal karena pemeriksaan deterministik QA menolak dan MEMINTA REVISI ke departemen (qa.action = return_to_<tahap>):
 * itu bukan blokir infrastruktur maupun fatal, melainkan putaran revisi QA yang harus dirutekan (seperti qaReturn dari qa-result.json).
 * Mengembalikan { to, rounds } atau null bila baris terakhir bukan hasil seperti itu.
 */
export function parseFinalizeReturn(line) {
  let d; try { d = JSON.parse(String(line ?? '')); } catch { return null; }
  const act = String(d?.qa?.action ?? '');
  const m = /^return_to_(researcher|copywriter|designer)$/.exec(act);
  if (!m) return null;
  const routeTo = [].concat(d.qa.routeTo ?? []).map(String);
  return { to: routeTo.includes(m[1]) ? m[1] : (routeTo[0] ?? m[1]), reason: String(d.qa.reason ?? '').slice(0, 200), rounds: d.qa.rounds ?? null };
}

/**
 * Pangkas properti yang TIDAK ada di skema (hanya pada objek ber-additionalProperties:false), rekursif lewat properties/items/$ref lokal.
 * Hanya bentuk: nilai yang dikenal tidak diubah, kekurangan properti wajib tidak ditebak (tetap ditolak skema). Mengembalikan { data, changes }.
 * Model kecil sering menambah properti seperti "title"/"conclusion" pada tiap hasil; satu putaran agen penuh terbuang per penolakan.
 */
export function pruneToSchema(data, schema, path = '', root = schema, changes = []) {
  const resolve = (s) => { let cur = s; for (let i = 0; i < 8 && cur && cur.$ref; i++) { const m = /^#\/\$defs\/(.+)$/.exec(cur.$ref); cur = m ? root.$defs?.[m[1]] : null; } return cur; };
  const sc = resolve(schema);
  if (!sc) return { data, changes };
  if (Array.isArray(data)) { return { data: data.map((x, i) => pruneToSchema(x, sc.items, `${path}/${i}`, root, changes).data), changes }; }
  if (data && typeof data === 'object' && sc.properties) {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (!(k in sc.properties)) { if (sc.additionalProperties === false) { changes.push(`${path || '(root)'}: properti "${k}" dibuang`); continue; } out[k] = v; continue; }
      out[k] = pruneToSchema(v, sc.properties[k], `${path}/${k}`, root, changes).data;
    }
    return { data: out, changes };
  }
  return { data, changes };
}

/** Penyebab blokir yang berasal dari GERBANG keluaran (bukan infrastruktur): sesudah perbaikan mekanis di kode, menilai ulang keluaran yang ada layak dicoba. */
export const GATE_BLOCK_RE = /tetap tidak lolos|render gagal|belum lolos gerbang|Validasi desain/i;

/** Nilai ulang otomatis (tanpa mengulang agen) untuk blokir gerbang, maks 2x per job, hanya yang baru. */
export function decideAutoRecheck({ job, nowMs, anotherActive, settings = {} }) {
  const s = { ...SUSTAIN_DEFAULTS, autoRecheckMax: 2, ...settings };
  if (!job || job.phase !== 'blocked' || !(job.stageIndex >= 0)) return { recheck: false, code: 'bukan-terblokir' };
  if (anotherActive) return { recheck: false, code: 'ada-job-aktif' };
  if (!GATE_BLOCK_RE.test(String(job.blockReason ?? ''))) return { recheck: false, code: 'bukan-gerbang' };
  if ((job.autoRechecks ?? 0) >= s.autoRecheckMax) return { recheck: false, code: 'jatah-habis' };
  const ended = job.endedMs ?? 0;
  if (!ended || nowMs - ended > 6 * HOUR) return { recheck: false, code: 'terlalu-lama' };
  if (nowMs - ended < 2 * MIN) return { recheck: false, code: 'tunggu' };
  return { recheck: true, code: 'nilai-ulang', attempt: (job.autoRechecks ?? 0) + 1 };
}

/**
 * Konten OTOMATIS yang berhenti di QA (jatah revisi habis / needs_human): serahkan ke antrean approval owner (owner tetap memutuskan; keputusan owner 17 Okt 2026),
 * sekali per job. Brief owner tidak pernah diserahkan otomatis. Dikendalikan settings.autoHandoffToOwner (bawaan true).
 */
export function decideAutoHandoff({ job, auto, nowMs, anotherActive, settings = {} }) {
  if (settings.autoHandoffToOwner === false) return { handoff: false, code: 'dimatikan' };
  if (!job || job.phase !== 'blocked' || job.stageIndex !== 4) return { handoff: false, code: 'bukan-qa' };
  if (!auto) return { handoff: false, code: 'bukan-otomatis' };
  if (job.autoHandoff) return { handoff: false, code: 'sudah' };
  if (anotherActive) return { handoff: false, code: 'ada-job-aktif' };
  if (!/QA masih menolak|needs_human|putaran|jatah/i.test(String(job.blockReason ?? ''))) return { handoff: false, code: 'bukan-jatah-qa' };
  const ended = job.endedMs ?? 0;
  if (!ended || nowMs - ended > 12 * HOUR) return { handoff: false, code: 'terlalu-lama' };
  if (nowMs - ended < 1 * MIN) return { handoff: false, code: 'tunggu' };
  return { handoff: true, code: 'serahkan-ke-owner' };
}

/**
 * Issue tahap yang diblokir Paperclip ("original assignee is not invokable") padahal produksinya SEDANG berjalan dengan issue tahap yang lebih baru: issue lama itu sudah
 * DIGANTIKAN dan hanya membuat agen (mis. QA) tampak "butuh manusia" di Pojok Bug. Aman dibatalkan walau komentar terakhirnya milik agen. Murni.
 */
export function supersededBlockedStage({ title, status, id, liveStageIds, runningProds }) {
  const m = /^(EDU-[0-9]+) · [A-Za-z]+/.exec(String(title ?? ''));
  return !!m && status === 'blocked' && !(liveStageIds?.has(id)) && !!runningProds?.has(m[1]);
}

/** Umpan balik untuk Designer saat gambar tak tersedia. */
export function fallbackFeedback(missing, minutes) {
  const list = (missing ?? []).map((m) => `- ${m.file}${m.reason ? ` (${String(m.reason).slice(0, 100)})` : ''}`).join('\n');
  return `Gambar asli berikut TIDAK bisa diambil setelah ±${Math.round(minutes)} menit dan tidak akan tersedia:\n${list}\n` +
    'Tulis ulang carousel-design.json TANPA gambar itu: pakai template yang tidak memakai slot gambar (angka besar, kutipan, poin, perbandingan, ajakan), atau aset tetap brand kit (logo EdukasiAI). ' +
    'Hapus entri itu dari asset-requests.json. Jangan mengganti dengan gambar lain yang tidak terverifikasi, dan jangan memakai placeholder.';
}
