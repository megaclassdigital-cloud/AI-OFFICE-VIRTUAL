// autonomy-core.mjs — inti KEPUTUSAN kantor otonom (ADR-0005 P3). Murni: tanpa I/O, tanpa LLM, tanpa jam sistem (waktu dioper).
// Tugasnya: (1) menilai apakah kantor boleh/perlu membuat brief baru sendiri, (2) membaca analitik akun menjadi profil audiens,
// (3) menyusun brief otomatis dari tren + profil audiens. Manager (LLM) tetap yang mengubah brief itu menjadi work order seperti brief owner.
// Pagar: hanya saat benar-benar menganggur, antrean approval owner tipis, batas harian, jeda, jam tenang, dan pemutus setelah gagal berturut-turut.

export const AUTO_MARKER = '<!-- brief-otomatis-manager -->';
export const isAutoBrief = (text) => String(text ?? '').includes(AUTO_MARKER);

const MIN = 60_000; const HOUR = 60 * MIN; const DAY = 24 * HOUR;

export const DEFAULTS = Object.freeze({
  enabled: true,
  utcOffsetMinutes: 420,          // WIB
  maxPerDay: 3,                   // brief otomatis per hari (hari lokal WIB)
  minGapMinutes: 120,             // jeda antar brief otomatis
  maxAwaitingOwner: 2,            // konten menunggu approval owner (jangan menumpuk lebih dari ini)
  quietHours: ['00:00-05:00'],    // tidak membuat brief pada jam tenang (WIB)
  freshHours: 48,                 // umur maksimal berita sejak sumber terbaru
  insightsRefreshHours: 12,       // analitik akun dibaca ulang bila lebih tua dari ini
  breakerFailures: 2,             // gagal berturut-turut (job otomatis terblokir) sebelum berhenti sendiri
  breakerHours: 6,                // lama berhenti setelah pemutus aktif
  autoReleasePlan: true,          // rencana brief otomatis dilepas sendiri (mode tinjau rencana tidak menahannya)
});

export const mergeSettings = (user = {}) => ({ ...DEFAULTS, ...user });

const parseWindow = (w) => { const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(String(w).trim()); return m ? { a: Number(m[1]) * 60 + Number(m[2]), b: Number(m[3]) * 60 + Number(m[4]) } : null; };
export const localMinutes = (ms, off) => Math.floor((((ms + off * MIN) % DAY) + DAY) % DAY / MIN);
export const localDay = (ms, off) => Math.floor((ms + off * MIN) / DAY);
export const inQuietHours = (settings, nowMs) => {
  const m = localMinutes(nowMs, settings.utcOffsetMinutes);
  return (settings.quietHours ?? []).map(parseWindow).filter(Boolean).some((w) => m >= w.a && m < w.b);
};

/**
 * Putuskan apakah kantor membuat brief otomatis sekarang.
 * ctx: { settings, nowMs, paused, offline, idle:{job,followers,pending,inbox}, awaitingOwner, briefLog:[{atMs}], recentAutoOutcomes:['ok'|'blocked',...] (terbaru terakhir), breakerUntilMs }
 * Mengembalikan { act, code, reason, retryAtMs? }.
 */
export function decideAutoBrief(ctx) {
  const s = mergeSettings(ctx.settings); const now = ctx.nowMs;
  if (!s.enabled) return { act: false, code: 'nonaktif', reason: 'Mode otonom dimatikan owner' };
  if (ctx.paused) return { act: false, code: 'dijeda', reason: 'Produksi dijeda owner' };
  if (ctx.offline) return { act: false, code: 'offline', reason: 'Internet/Paperclip tidak tersedia' };
  const busy = (ctx.idle?.job ? 1 : 0) + (ctx.idle?.followers ?? 0) + (ctx.idle?.pending ?? 0) + (ctx.idle?.inbox ?? 0);
  if (busy > 0) return { act: false, code: 'sibuk', reason: 'Masih ada pekerjaan berjalan atau antre' };
  if (ctx.breakerUntilMs && now < ctx.breakerUntilMs) return { act: false, code: 'pemutus', reason: 'Berhenti sementara setelah brief otomatis gagal berturut-turut', retryAtMs: ctx.breakerUntilMs };
  const out = ctx.recentAutoOutcomes ?? [];
  const tail = out.slice(-s.breakerFailures);
  if (tail.length >= s.breakerFailures && tail.every((x) => x === 'blocked')) return { act: false, code: 'pemutus', reason: `Brief otomatis gagal ${s.breakerFailures}x berturut-turut`, trip: true, retryAtMs: now + s.breakerHours * HOUR };
  if (inQuietHours(s, now)) return { act: false, code: 'jam-tenang', reason: 'Jam tenang (tidak membuat brief)' };
  if ((ctx.awaitingOwner ?? 0) >= s.maxAwaitingOwner) return { act: false, code: 'antrean-owner', reason: `${ctx.awaitingOwner} konten menunggu approval owner (batas ${s.maxAwaitingOwner})` };
  const log = ctx.briefLog ?? [];
  const today = log.filter((e) => localDay(e.atMs, s.utcOffsetMinutes) === localDay(now, s.utcOffsetMinutes)).length;
  if (today >= s.maxPerDay) return { act: false, code: 'batas-harian', reason: `Batas ${s.maxPerDay} brief otomatis hari ini tercapai` };
  const last = log.length ? Math.max(...log.map((e) => e.atMs)) : 0;
  if (last && now - last < s.minGapMinutes * MIN) return { act: false, code: 'jeda', reason: `Jeda ${s.minGapMinutes} menit antar brief`, retryAtMs: last + s.minGapMinutes * MIN };
  return { act: true, code: 'aktif', reason: 'Kantor menganggur dan antrean owner tipis: Manager mengambil inisiatif' };
}

// ───────── analitik akun -> profil audiens ─────────
const DATE_RE = /^[A-Z][a-z]{2} \d{1,2}(?:, \d{4})?, \d{1,2}:\d{2}\s?(?:AM|PM)$/;
const PRIVACY = new Set(['Everyone', 'Only me', 'Friends', 'Followers']);
const NOISE = /^(content under review|under review|pinned|edit|promote)$/i;
export const parseCount = (t) => {
  const m = /^([0-9][0-9.,]*)\s*([KMB])?$/i.exec(String(t ?? '').trim()); if (!m) return null;
  const n = Number(m[1].replace(/,/g, '')); if (!Number.isFinite(n)) return null;
  return Math.round(n * ({ K: 1e3, M: 1e6, B: 1e9 }[String(m[2] ?? '').toUpperCase()] ?? 1));
};

/** Teks halaman TikTok Studio "Content" -> [{title, dateText, privacy, views, likes, comments}]. Baris tak dikenal dilewati, tidak dikarang. */
export function parseTikTokContent(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const start = lines.findIndex((l) => /^Actions$/i.test(l));
  const body = start >= 0 ? lines.slice(start + 1) : lines;
  const posts = []; let buf = [];
  for (let i = 0; i < body.length; i++) {
    if (!DATE_RE.test(body[i])) { buf.push(body[i]); continue; }
    const title = buf.filter((l) => !NOISE.test(l)).join(' ').trim(); buf = [];
    let j = i + 1; let privacy = null;
    if (PRIVACY.has(body[j])) { privacy = body[j]; j++; }
    const nums = []; while (nums.length < 3 && j < body.length) { const n = parseCount(body[j]); if (n === null) break; nums.push(n); j++; }
    if (title && nums.length === 3) posts.push({ title, dateText: body[i], privacy, views: nums[0], likes: nums[1], comments: nums[2] });
    i = j - 1;
  }
  return posts;
}

const STOP = new Set('yang dan di ke dari untuk dengan ini itu atau pada akan juga lebih semakin bukan cuma saja sebagai dalam oleh adalah bisa para kita kami anda lo gue menurut simak detail poin pentingnya follow support riset kami lewat link bio satu sisi lain kuat besar baru terbaru the and for with that this are from your about slide hingga mulai merilis menghadirkan meluncurkan'.split(' '));
const BRAND_TAGS = new Set(['#edukasiai', '#beritaai', '#kecerdasanbuatan', '#aiindonesia']);
export const engagement = (p) => (p.views ?? 0) + 25 * (p.likes ?? 0) + 40 * (p.comments ?? 0);

const termsOf = (title) => {
  const out = new Set();
  for (const h of String(title).match(/#[\p{L}\p{N}_]+/gu) ?? []) { const t = h.toLowerCase(); if (!BRAND_TAGS.has(t)) out.add(h); }
  const body = String(title).replace(/#[\p{L}\p{N}_]+/gu, ' ');
  // entitas: kata berhuruf besar di tengah kalimat atau berhuruf campur (OpenAI, GPT-5, Claude)
  for (const m of body.matchAll(/(?<![.!?]\s)(?<!^)\b([A-Z][\p{L}\p{N}]{2,}(?:[-.][\p{L}\p{N}]+)*)\b/gu)) { const w = m[1]; if (!STOP.has(w.toLowerCase())) out.add(w); }
  return [...out];
};

/** Profil audiens dari performa posting sendiri. Setiap angka dihitung dari data; sedikit data => catatan keterbatasan, bukan tebakan. */
export function analyzeInsights(posts) {
  const list = (posts ?? []).filter((p) => Number.isFinite(p.views));
  if (!list.length) return { n: 0, notes: ['Belum ada data posting di akun.'], topTerms: [], best: [], worst: [], recentTitles: [] };
  const sum = (f) => list.reduce((a, p) => a + f(p), 0);
  const avgViews = Math.round(sum((p) => p.views) / list.length);
  const likeRate = sum((p) => p.views) ? sum((p) => p.likes) / sum((p) => p.views) : 0;
  const ranked = [...list].sort((a, b) => engagement(b) - engagement(a));
  const byTerm = new Map();
  for (const p of list) for (const t of termsOf(p.title)) { const e = byTerm.get(t) ?? { term: t, posts: 0, total: 0 }; e.posts += 1; e.total += engagement(p); byTerm.set(t, e); }
  const topTerms = [...byTerm.values()].map((e) => ({ term: e.term, posts: e.posts, avgScore: Math.round(e.total / e.posts) })).sort((a, b) => b.avgScore - a.avgScore || b.posts - a.posts).slice(0, 8);
  const short = (t) => String(t).replace(/\s+/g, ' ').slice(0, 90);
  const best = ranked.slice(0, 3).map((p) => ({ title: short(p.title), views: p.views, likes: p.likes, comments: p.comments, dateText: p.dateText }));
  const worst = ranked.slice(-2).filter((p) => !best.some((b) => b.title === short(p.title))).map((p) => ({ title: short(p.title), views: p.views, likes: p.likes }));
  const withQ = list.filter((p) => /\?/.test(String(p.title).split(/[.!]/)[0])); const noQ = list.filter((p) => !withQ.includes(p));
  const avgScore = (a) => (a.length ? Math.round(a.reduce((x, p) => x + engagement(p), 0) / a.length) : null);
  const notes = [`Rata-rata ${avgViews} views per posting dari ${list.length} posting; rasio like ${(likeRate * 100).toFixed(1)}% dari views.`];
  if (best[0]) notes.push(`Posting terbaik: "${best[0].title}" (${best[0].views} views, ${best[0].likes} like).`);
  if (topTerms.length) notes.push(`Topik/entitas dengan performa tertinggi: ${topTerms.slice(0, 5).map((t) => t.term).join(', ')}.`);
  if (withQ.length >= 2 && noQ.length >= 2) notes.push(avgScore(withQ) > avgScore(noQ) ? 'Pembuka berbentuk pertanyaan cenderung lebih baik dari pernyataan.' : 'Pembuka berbentuk pernyataan cenderung sama atau lebih baik dari pertanyaan.');
  if (list.length < 8) notes.push(`Data masih sedikit (${list.length} posting): anggap pola ini indikasi awal, bukan kepastian.`);
  return { n: list.length, avgViews, likeRate: Number(likeRate.toFixed(4)), topTerms, best, worst, notes, recentTitles: list.map((p) => short(p.title)) };
}

// ───────── brief otomatis ─────────
const wib = (ms, off) => new Date(ms + off * MIN).toISOString().slice(0, 16).replace('T', ' ');

/**
 * Brief otomatis dalam Bahasa Indonesia. Hanya memuat fakta dari data (profil audiens, judul terbaru); tidak mengarang topik berita:
 * topik dicari Researcher dari berita nyata, dipandu profil audiens dan batas kesegaran.
 */
export function buildAutoBrief({ nowMs, utcOffsetMinutes = 420, insights = null, recentTitles = [], freshHours = 48, insightsAtMs = null }) {
  const stamp = wib(nowMs, utcOffsetMinutes);
  const lines = [AUTO_MARKER, `# Konten otomatis Manager: tren AI terbaru (${stamp} WIB)`, '',
    '> Brief ini dibuat sendiri oleh Manager (mode otonom, tanpa arahan owner). Susun work order seperti biasa. Owner tetap memutuskan approval akhir.', '',
    '## Tujuan', '',
    'Buat SATU carousel baru (6-8 slide) untuk akun @edukasiai.co.id tentang berita/tren AI yang **paling hangat dan paling relevan untuk audiens kita**.', '',
    '## Riset tren (Researcher)', '',
    `- Sapu berita dan tren AI dalam **${freshHours} jam terakhir** (umur dihitung dari sumber TERBARU). Prioritaskan sumber primer di whitelist (rilis resmi, blog riset, dokumentasi).`,
    '- Kumpulkan 5-8 kandidat, lalu urutkan menurut: kebaruan, dampak nyata bagi pelajar/pekerja/kreator di Indonesia, dan kecocokan dengan profil audiens di bawah.',
    '- Jangan mengarang angka, nama, atau tanggal. Setiap klaim wajib punya URL sumber yang bisa diverifikasi.', ''];
  lines.push('## Profil audiens (dari performa akun)', '');
  if (insights?.n) {
    for (const n of insights.notes) lines.push(`- ${n}`);
    if (insightsAtMs) lines.push(`- Data dibaca ${wib(insightsAtMs, utcOffsetMinutes)} WIB.`);
    lines.push('- Pakai ini sebagai **kecenderungan**, bukan aturan kaku: kualitas sumber dan ketepatan tetap yang utama.');
  } else lines.push('- Data performa akun belum tersedia untuk siklus ini. Pilih topik berdasarkan kebaruan dan dampak, dan tulis dengan gaya yang sudah dipakai di konten sebelumnya.');
  lines.push('');
  if (recentTitles.length) {
    lines.push('## Jangan mengulang topik ini (sudah dibuat atau diposting)', '');
    for (const t of recentTitles.slice(0, 12)) lines.push(`- ${t}`);
    lines.push('');
  }
  lines.push('## Gaya konten', '',
    '- Bahasa Indonesia santai namun akurat; hook kuat di slide 1; jelaskan **apa artinya bagi audiens** (bukan sekadar ringkasan rilis).',
    '- Satu angle jelas per carousel. Caption singkat dengan ajakan yang wajar (simpan/bagikan/diskusi).',
    '- Ikuti brand kit dan template yang berlaku; Designer hanya mengisi `carousel-design.json`.', '');
  return lines.join('\n');
}

/** Hasil job otomatis dari riwayat orkestrator: 'ok' bila selesai, 'blocked' bila terblokir. Hanya job yang briefnya bertanda otomatis. */
export function autoOutcomes(history, sinceMs = 0) {
  return (history ?? []).filter((j) => isAutoBrief(j.brief) && (j.endedMs ?? 0) > sinceMs).sort((a, b) => (a.endedMs ?? 0) - (b.endedMs ?? 0)).map((j) => (j.phase === 'done' ? 'ok' : 'blocked'));
}
