import { ownerDecisionPanel } from "./owner-ui.js";
// tv.js — "TV" dashboard opened by clicking the Papan Tayang. One tab per division, each showing its OUTPUT in plain language
// (not logs), plus the slide viewer. Data comes from /api/inspect/production (built by code from the artifacts; no LLM).
// All agent/Paperclip text is rendered with textContent only.
const $ = (id) => document.getElementById(id);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
// replaceChildren(null) menulis teks "null" di DOM: saring nilai kosong dan ratakan array.
function setKids(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false)); }
const jget = (u) => fetch(u, { cache: 'no-store' }).then((r) => r.json());
const img = (p) => `/api/inspect/image?path=${encodeURIComponent(p)}`;
const dlUrl = (p) => `${img(p)}&download=1`;
// Unduh SATU gambar per slide (bukan gabungan): tiap berkas diunduh terpisah dengan jeda singkat agar browser tidak memblokir.
async function downloadAll(slides) { for (const s of slides) { const a = document.createElement('a'); a.href = dlUrl(s.image); a.download = ''; document.body.append(a); a.click(); a.remove(); await new Promise((r) => setTimeout(r, 450)); } }
const TABS = [['all', '📚 Semua Konten'], ['show', '🎞️ Tayangan'], ['manager', '🧭 Manager'], ['researcher', '🔎 Researcher'], ['verifier', '🛡️ Verifier'], ['copywriter', '✍️ Copywriter'], ['designer', '🎨 Designer'], ['qa', '✅ QA'], ['publikasi', '📣 Publikasi'], ['otonom', '🤖 Otonom']];

const st = { prod: null, rev: '', tab: 'all', data: null, slide: 0, sig: '', board: [] };
const sel = h('select', { id: 'tvProd', 'aria-label': 'Pilih produksi', onchange: () => { st.prod = sel.value; st.rev = ''; st.slide = 0; load(true); } });
const revSel = h('select', { id: 'tvRev', 'aria-label': 'Pilih versi', hidden: true, onchange: () => { st.rev = revSel.value; st.slide = 0; load(true); } });
const chip = h('span', { class: 'tv-chip' });
const main = h('main', { id: 'tvMain' });
const stages = h('footer', { id: 'tvStages' });
const tabs = h('nav', { class: 'tv-tabs', role: 'tablist' }, TABS.map(([k, l]) => h('button', { type: 'button', role: 'tab', 'data-tab': k, onclick: () => { st.tab = k; render(); } }, l)));
const overlay = h('div', { id: 'tv', hidden: true, role: 'dialog', 'aria-label': 'Dashboard Papan Tayang' },
  h('div', { class: 'tv-bezel' },
    h('header', {}, h('div', { class: 'tv-title' }, '📺 PAPAN TAYANG'), sel, revSel, chip, h('button', { type: 'button', class: 'tv-x', title: 'Tutup (Esc)', onclick: () => close() }, '✕')),
    tabs, main, stages));
document.body.append(overlay);
const tvBtn = h('button', { type: 'button', id: 'bTV', title: 'Buka dashboard Papan Tayang', onclick: () => open() }, '📺 TV');
document.querySelector('#bar .ctl')?.prepend(tvBtn);

function open() { overlay.hidden = false; load(true); }
function close() { overlay.hidden = true; }
addEventListener('office:select', (e) => { if (e.detail?.type === 'board') open(); });
addEventListener('keydown', (e) => {
  if (overlay.hidden) return;
  if (e.key === 'Escape') close();
  else if (st.tab === 'show' && e.key === 'ArrowRight') go(1); else if (st.tab === 'show' && e.key === 'ArrowLeft') go(-1);
});
overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
setInterval(() => { if (!overlay.hidden) load(false); }, 8000);

async function load(force) {
  let board = { items: [] };
  // Server tidak terjangkau/lambat: pakai daftar terakhir yang baik (memori halaman, lalu penyimpanan browser) supaya riwayat tidak hilang dari TV.
  try { board = await jget('/api/inspect/board'); st.offline = false; try { if (board.items?.length) localStorage.setItem('aao.board', JSON.stringify({ at: Date.now(), items: board.items })); } catch { /* penyimpanan browser tidak tersedia */ } }
  catch {
    st.offline = true;
    if (st.board?.length) board = { items: st.board };
    else { try { const c = JSON.parse(localStorage.getItem('aao.board') ?? 'null'); if (c?.items?.length) board = { items: c.items, cachedAt: new Date(c.at).toISOString() }; } catch { /* abaikan */ } }
  }
  st.stale = Boolean(board.stale) || st.offline;
  st.board = board.items ?? [];
  if (force || !sel.options.length) {
    setKids(sel, ...board.items.map((i) => h('option', { value: i.prod }, `${i.label ?? i.prod} · ${tgl(i.createdAt).split(',')[0]} · ${i.title}`.slice(0, 80))));
    if (!st.prod || !board.items.some((i) => i.prod === st.prod)) st.prod = board.items[0]?.prod ?? null;
    sel.value = st.prod ?? '';
  }
  if (!st.prod) { st.data = null; render(); return; }
  let d; try { d = await jget(`/api/inspect/production?prod=${encodeURIComponent(st.prod)}${st.rev !== '' ? `&rev=${encodeURIComponent(st.rev)}` : ''}`); } catch { d = null; }
  const sig = JSON.stringify(d);
  if (sig === st.sig && !force) return;
  st.sig = sig; st.data = d && !d.error ? d : null;
  // pemilih versi (asli / revisi N) hanya tampil bila konten punya revisi; default = versi terbaru
  const vs = st.data?.versions ?? [];
  revSel.hidden = vs.length < 2;
  if (vs.length >= 2) { setKids(revSel, ...vs.map((v) => h('option', { value: String(v.rev) }, v.label))); revSel.value = String(st.data.revision); }
  render();
}

const tgl = (iso) => { const t = typeof iso === 'number' ? iso : Date.parse(iso ?? ''); return Number.isFinite(t) ? new Date(t).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace('.', ':') : 'tanggal tidak diketahui'; };
const hhmm = (ms) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
const card = (...k) => h('div', { class: 'tv-card' }, ...k);
const empty = (t = 'Belum ada hasil dari divisi ini untuk produksi ini.') => h('p', { class: 'tv-empty' }, t);
const lead = (t) => h('p', { class: 'tv-lead' }, t);
const go = (d) => { const n = st.data?.slides?.length ?? 0; if (!n) return; st.slide = (st.slide + d + n) % n; render(); };

// LIVE: titik berdenyut lewat CSS; daftar platform dari posted.json (ditulis Admin Publikasi), bukan dikarang.
const statusText = (s) => (s?.key === 'live' ? `● LIVE · ${(s.platforms ?? []).join(' + ')}` : s?.key === 'tidak_pasti' ? `⚠ POSTING TIDAK PASTI · ${(s.unsure ?? []).join(' + ')}` : (s?.label ?? ''));
function render() {
  for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === st.tab);
  const d = st.data;
  chip.textContent = statusText(d?.status); chip.className = `tv-chip ${d?.status?.tone ?? ''}`;
  setKids(stages, ...(d?.stages ?? []).map((s) => h('div', { class: `stg ${s.state}`, title: s.label }, h('span', { class: 'dot' }), h('b', {}, s.agent), h('small', {}, s.state === 'done' && s.doneAt ? `selesai ${hhmm(s.doneAt)}` : s.state === 'running' ? 'sedang bekerja' : s.state === 'hold' ? 'menunggu gambar asli' : s.state === 'blocked' ? 'terblokir' : s.label))));
  if (st.tab === 'all') { setKids(main, allContents()); return; }
  if (st.tab === 'publikasi') { setKids(main, publikasi()); loadPub(); return; }
  if (st.tab === 'otonom') { setKids(main, otonom()); loadAuto(); return; }
  if (!d) { setKids(main, empty(st.prod ? 'Memuat…' : 'Belum ada produksi yang bisa ditayangkan.')); return; }
  const view = { show, manager, researcher, verifier, copywriter, designer, qa }[st.tab];
  // replaceChildren(null) menulis teks "null": susun daftar anak tanpa nilai kosong.
  setKids(main, ...[d.paperclipOk === false ? h('div', { class: 'tv-warn' }, '⚠ Paperclip tidak terhubung: status produksi mungkin belum akurat. Hasil kerja di bawah dibaca langsung dari berkas.') : null, holdBanner(d), d.slidesFrom ? h('div', { class: 'tv-warn' }, `ℹ Versi ini belum dirender. Slide yang tampil adalah milik ${d.slidesFrom}, bukan hasil terbaru.`) : null, view(d)].filter(Boolean));
}

// Produksi ditahan menunggu gambar asli: tampilkan apa yang kurang dan cara melanjutkannya (bukan sekadar "sedang bekerja").
function holdBanner(d) {
  if (!d?.hold?.missing?.length) return null;
  return h('div', { class: 'tv-warn' }, h('b', {}, `⏸ Ditahan: ${d.hold.missing.length} gambar asli belum terambil.`), ' ',
    d.hold.missing.map((m) => m.file).join(', '), '. Desain sudah selesai; produksi lanjut sendiri setelah gambarnya ada. Selesaikan verifikasi Google (node scripts/browser-login.mjs) atau taruh gambar di workspace/inbox/assets/', d.runKey ?? d.prod, '/.');
}

// Tab Publikasi: Admin Publikasi (kode, tanpa AI). Status dibaca dari /api/inspect/autopost; hitung mundur jeda dihitung di sini dari nextAllowedAt.
const sisa = (ms) => { if (ms <= 0) return 'siap'; const m = Math.ceil(ms / 60000); const j = Math.floor(m / 60); const mm = m % 60; return j ? `${j} jam${mm ? ` ${mm} menit` : ''}` : `${mm} menit`; };
const STATUS_LABEL = { diposting: '✔ diposting', sedang_diposting: '⏳ sedang diposting', tidak_pasti: '⚠ tidak pasti (periksa akun)', gagal: '✖ gagal sebelum terkirim', dry_run_ok: '🧪 dry-run lolos', dry_run_gagal: '🧪 dry-run gagal' };
async function loadPub() {
  if (st.pubAt && Date.now() - st.pubAt < 4000) return;
  st.pubAt = Date.now();
  try { st.pub = await jget('/api/inspect/autopost'); } catch { st.pub = { error: true }; }
  if (st.tab === 'publikasi' && !overlay.hidden) setKids(main, publikasi());
}
function publikasi() {
  const d = st.pub; if (!d) return empty('Memuat…');
  if (d.error) return empty('Tidak bisa memuat status Admin Publikasi.');
  const s = d.status;
  if (!s) return empty('Admin Publikasi belum menulis status. Pastikan komponennya berjalan.');
  const now = Date.now();
  const chip = (t, tone) => h('span', { class: `tv-chip ${tone}` }, t);
  const platformCard = ([name, p]) => {
    const remain = p.nextAllowedAt ? Math.max(0, Date.parse(p.nextAllowedAt) - now) : 0;
    return card(h('h4', {}, name === 'instagram' ? '📷 Instagram' : name === 'tiktok' ? '🎵 TikTok' : name), chip(p.live ? 'LIVE' : 'DRY-RUN', p.live ? 'ok' : 'warn'),
      h('p', {}, p.lastPostAt ? `Posting terakhir: ${tgl(p.lastPostAt)}` : 'Belum pernah memposting.'),
      h('p', {}, h('b', {}, 'Boleh posting lagi: '), remain > 0 ? `dalam ${sisa(remain)} (jeda ${s.cooldownHours} jam dari posting terakhir)` : 'siap'),
      h('p', { class: 'sub' }, `Total diposting: ${p.postedTotal}`));
  };
  const rows = (d.recent ?? []).map((e) => h('li', {}, `${tgl(e.at)} · ${e.content} → ${e.platform}${e.mode === 'dry-run' ? ' (dry-run)' : ''}: ${STATUS_LABEL[e.status] ?? e.status}${e.error ? ` · ${e.error}` : ''}`));
  return h('div', {},
    lead(`Admin Publikasi (kode, tanpa AI): memposting konten yang sudah kamu approve, dengan jeda ${s.cooldownHours} jam dari posting terakhir.`),
    h('div', { class: 'tv-warn', hidden: !s.paused }, '⏸ DIJEDA: tidak ada yang diposting sampai dilanjutkan.'),
    h('div', { class: 'tv-grid' }, Object.entries(s.platforms ?? {}).map(platformCard)),
    card(h('h4', {}, 'Antrean'), h('p', {}, `${s.approvedWaiting} konten approved menunggu giliran.`),
      s.since ? h('p', { class: 'sub' }, `Hanya approval setelah ${tgl(s.since)} yang diposting otomatis; ${s.ignoredOld} konten lama yang sudah approved diabaikan.`) : h('p', { class: 'sub' }, 'Posting otomatis belum dinyalakan (autopostSince kosong).'),
      ...(s.blocked ?? []).slice(0, 3).map((b) => h('p', { class: 'sub' }, `Ditahan ${b.content}/${b.platform}: ${b.reasons.join('; ')}`))),
    card(h('h4', {}, 'Riwayat terakhir'), rows.length ? h('ul', {}, rows) : h('p', { class: 'sub' }, 'Belum ada catatan.')));
}
setInterval(() => { if (!overlay.hidden && st.tab === 'publikasi') { st.pubAt = 0; loadPub(); } }, 15000);

// Tab Otonom: Manager mengambil inisiatif membuat brief saat kantor menganggur (status dari kode, bukan LLM). Baca-saja; pengaturan lewat settings.json.
async function loadAuto() {
  if (st.autoAt && Date.now() - st.autoAt < 4000) return;
  st.autoAt = Date.now();
  try { st.auto = await jget('/api/inspect/autonomy'); } catch { st.auto = { error: true }; }
  if (st.tab === 'otonom' && !overlay.hidden) setKids(main, otonom());
}
const AUTO_LABEL = { aktif: 'Bertindak', 'brief-dibuat': 'Brief dibuat', 'menunggu-analitik': 'Membaca analitik akun', sibuk: 'Produksi berjalan', 'antrean-owner': 'Menunggu approval owner', 'batas-harian': 'Batas harian tercapai', jeda: 'Jeda antar brief', 'jam-tenang': 'Jam tenang', pemutus: 'Berhenti sementara (gagal berturut-turut)', dijeda: 'Dijeda owner', offline: 'Offline', nonaktif: 'Dimatikan' };
function otonom() {
  const d = st.auto; if (!d) return empty('Memuat…');
  if (d.error) return empty('Tidak bisa memuat status kantor otonom.');
  const s = d.status;
  if (!s) return empty('Kantor otonom belum menulis status. Pastikan orkestrator berjalan.');
  const chip = (t, tone) => h('span', { class: `tv-chip ${tone}` }, t);
  const tone = s.code === 'brief-dibuat' || s.code === 'sibuk' ? 'ok' : ['pemutus', 'offline'].includes(s.code) ? 'bad' : 'warn';
  const a = d.insights?.analysis;
  return h('div', {},
    lead('Saat semua pekerjaan selesai dan antrean approval tipis, Manager menulis brief baru sendiri: riset tren + profil audiens dari performa akun. Owner tetap memutuskan approval akhir.'),
    h('div', { class: 'tv-grid' },
      card(h('h4', {}, 'Status sekarang'), chip(s.enabled ? (AUTO_LABEL[s.code] ?? s.code) : 'DIMATIKAN', s.enabled ? tone : 'bad'), h('p', {}, s.reason ?? ''),
        s.retryAtMs ? h('p', { class: 'sub' }, `Dicek lagi setelah ${tgl(s.retryAtMs)}`) : null,
        h('p', { class: 'sub' }, `Brief otomatis 24 jam terakhir: ${s.briefsToday} · menunggu approval owner: ${s.awaitingOwner}`)),
      card(h('h4', {}, 'Pagar'), h('p', {}, `Maks ${s.settings?.maxPerDay} brief/hari · jeda ${s.settings?.minGapMinutes} menit · maks ${s.settings?.maxAwaitingOwner} menunggu approval`),
        h('p', { class: 'sub' }, `Jam tenang (WIB): ${(s.settings?.quietHours ?? []).join(', ') || '-'}. Ubah di workspace/agent/autonomy/settings.json (enabled: false untuk mematikan).`))),
    card(h('h4', {}, 'Profil audiens (dari performa akun)'),
      a?.n ? h('div', {}, h('ul', {}, a.notes.map((n) => h('li', {}, n))), a.best?.length ? h('p', { class: 'sub' }, 'Terbaik: ' + a.best.map((b) => `"${b.title}" (${b.views} views)`).join(' · ')) : null, h('p', { class: 'sub' }, `Sumber: ${d.insights.source} · dibaca ${tgl(d.insights.at)}`))
        : h('p', { class: 'sub' }, 'Belum ada data analitik. Dibaca otomatis sebelum brief pertama.')),
    card(h('h4', {}, 'Brief otomatis terakhir'), (d.recent ?? []).length ? h('ul', {}, d.recent.map((e) => h('li', {}, `${tgl(e.atMs)} · ${e.file}${e.withInsights ? '' : ' (tanpa profil audiens)'}`))) : h('p', { class: 'sub' }, 'Belum ada.')));
}
setInterval(() => { if (!overlay.hidden && st.tab === 'otonom') { st.autoAt = 0; loadAuto(); } }, 15000);

// Daftar SEMUA konten (tidak ada yang disembunyikan), terbaru dibuat di atas, lengkap dengan tanggal dibuat dan status.
function allContents() {
  const items = st.board ?? [];
  if (!items.length) return empty('Belum ada konten.');
  return h('div', {}, st.stale ? h('div', { class: 'tv-warn' }, '⚠ Koneksi ke server/Paperclip bermasalah: menampilkan daftar terakhir yang tersimpan. Semua konten tetap ada; status bisa tertinggal sampai tersambung lagi.') : null, lead(`${items.length} konten. Klik kartu untuk membuka tayangannya.`),
    h('div', { class: 'tv-all' }, items.map((i) => h('button', { type: 'button', class: 'tv-item', onclick: () => { st.prod = i.prod; st.rev = ''; st.slide = 0; st.tab = 'show'; sel.value = i.prod; load(true); }, title: i.title },
      i.cover ? h('div', { class: 'cv' }, h('img', { src: img(i.cover), alt: '', loading: 'lazy' }), i.coverFrom ? h('span', { class: 'cvnote' }, `gambar ${i.coverFrom}`) : null) : h('div', { class: 'ph' }, 'belum ada gambar'),
      h('div', { class: 'meta' },
        h('div', { class: 'row' }, h('b', {}, i.label ?? i.prod), h('span', { class: `tv-chip ${i.status?.tone ?? ''}` }, statusText(i.status))),
        h('div', { class: 'ttl' }, i.title),
        h('div', { class: 'sub' }, `📅 Dibuat ${tgl(i.createdAt)}`),
        h('div', { class: 'sub' }, i.slides ? `${i.slides} slide` : 'belum ada slide'))))));
}

function show(d) {
  const slides = d.slides ?? [];
  if (!slides.length) return empty('Belum ada slide yang dirender.');
  const cur = slides[Math.min(st.slide, slides.length - 1)];
  const cp = d.copy?.slides?.find((s) => s.index === cur.index);
  const viewer = h('div', { class: 'tv-viewer' },
    h('button', { type: 'button', class: 'nav', onclick: () => go(-1), 'aria-label': 'Slide sebelumnya' }, '‹'),
    h('a', { href: img(cur.image), target: '_blank', rel: 'noopener', title: 'Buka ukuran penuh' }, h('img', { src: img(cur.image), alt: `Slide ${cur.index}` })),
    h('button', { type: 'button', class: 'nav', onclick: () => go(1), 'aria-label': 'Slide berikutnya' }, '›'));
  const thumbs = h('div', { class: 'tv-thumbs' }, slides.map((s, i) => h('button', { type: 'button', class: i === st.slide ? 'on' : '', onclick: () => { st.slide = i; render(); } }, h('img', { src: img(s.image), alt: `Slide ${s.index}`, loading: 'lazy' }))));
  const k = d.stats ?? {};
  const kpi = h('div', { class: 'tv-kpi' }, [['🎞️', k.slides, 'slide'], ['🔎', k.candidates, 'kandidat'], ['🛡️', `${k.verified}/${k.candidates}`, 'terverifikasi'], ['🔗', k.sources, 'sumber'], ['✅', k.qa, 'QA']].map(([i, v, l]) => h('div', {}, h('b', {}, `${i} ${v}`), h('small', {}, l))));
  const hasTags = d.caption && (d.hashtags ?? []).some((t) => d.caption.includes(t));
  const side = h('div', { class: 'tv-side' },
    h('h3', {}, d.title), kpi, decision(d),
    h('p', { class: 'sub' }, `Slide ${cur.index} dari ${slides.length}${cp ? ' · ' + cp.roleLabel : ''}`),
    cp ? card(h('b', {}, cp.heading), h('p', {}, cp.body)) : null,
    d.caption ? card(h('h4', {}, 'Caption'), h('p', { class: 'pre' }, d.caption), !hasTags && d.hashtags?.length ? h('p', { class: 'sub' }, d.hashtags.join(' ')) : null) : null,
    d.sources?.length ? card(h('h4', {}, 'Sumber'), h('ul', {}, d.sources.map((s) => h('li', {}, h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.name ?? s.url), s.title ? ` — ${s.title}` : '')))) : null);
  const dl = h('div', { class: 'tv-dl' },
    h('a', { class: 'btn', href: dlUrl(cur.image), download: '' }, `⬇ Unduh slide ${cur.index}`),
    h('button', { type: 'button', class: 'btn', onclick: () => downloadAll(slides) }, `⬇ Unduh semua ${slides.length} slide (satu per satu)`));
  return h('div', { class: 'tv-show' }, h('div', { class: 'tv-stage' }, viewer, thumbs, dl), side);
}
// Keputusan tetap dijalankan Owner di terminalnya; TV hanya menyiapkan perintah.
function decision(d) {
  if (!d.master?.hasHandoff || d.status.key !== 'menunggu_approval') return d.status.key === 'disetujui' ? card(h('b', {}, '✔ Sudah disetujui Owner')) : null;
  const cmd = (t) => h('div', { class: 'cmd' }, h('code', {}, t), h('button', { type: 'button', onclick: async (e) => { try { await navigator.clipboard.writeText(t); e.target.textContent = 'tersalin ✔'; } catch { e.target.textContent = 'salin manual'; } } }, 'salin'));
  return h('div', { class: 'tv-card decide' }, h('h4', {}, 'Menunggu keputusan Owner'), ownerDecisionPanel({ issueId: d.master.id, cmdFallback: cmd }));
}

// Kartu "Model Manager": owner memilih dan MENGUNCI model Manager (mis. ChatGPT) atau kembali ke Otomatis. Butuh PIN; server yang menegakkan.
let modelEl = null;
function modelCard() {
  if (modelEl) { refreshModels(); return modelEl; }
  const body = h('div', { class: 'model-body' }, h('p', { class: 'sub' }, 'Memuat…'));
  modelEl = h('div', { class: 'tv-card model-card' }, h('h4', {}, '🧭 Model Manager'), body);
  modelEl._body = body;
  refreshModels();
  return modelEl;
}
async function refreshModels() {
  const body = modelEl?._body; if (!body) return;
  let m = null; try { m = await jget('/api/owner/models'); } catch { /* server lama */ }
  if (!m || !m.chain) { body.replaceChildren(h('p', { class: 'sub' }, 'Pilihan model belum tersedia (Office View perlu --enable-owner dan PIN diatur).')); return; }
  const label = (id) => m.chain.find((e) => e.id === id)?.label ?? id ?? 'tidak dikenal';
  const hh = (ms) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
  const blocked = Object.entries(m.blocked ?? {}).map(([id, until]) => `${label(id)} diblokir sampai ${hh(until)}`);
  const sel = h('select', { class: 'owner-stage', 'aria-label': 'Pilih model Manager' },
    h('option', { value: 'auto' }, 'Otomatis (pindah sendiri saat limit/login habis)'),
    m.chain.map((e) => h('option', { value: e.id }, `Kunci ke: ${e.label}`)));
  sel.value = m.pinned ?? 'auto';
  const pin = h('input', { type: 'password', autocomplete: 'off', placeholder: 'PIN owner', class: 'owner-pin', 'aria-label': 'PIN owner' });
  const msg = h('div', { class: 'owner-msg', role: 'status' });
  const go = h('button', { type: 'button', class: 'owner-approve', onclick: async () => {
    if (!pin.value) { msg.textContent = 'Isi PIN owner dulu.'; msg.className = 'owner-msg bad'; return; }
    go.disabled = true; msg.textContent = 'Memproses…'; msg.className = 'owner-msg';
    let r; try { r = await fetch('/api/owner/switch-model', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entry: sel.value, pin: pin.value }) }); } catch { r = null; }
    const data = r ? await r.json().catch(() => ({})) : {};
    pin.value = ''; go.disabled = false;
    if (!r?.ok) { msg.textContent = data.error ?? 'Gagal mengganti model'; msg.className = 'owner-msg bad'; return; }
    msg.textContent = data.mode === 'otomatis' ? 'Kembali otomatis.' : (data.deferred ? 'Terkunci. Manager sedang bekerja; model dipasang begitu ia menganggur.' : 'Model dipasang dan dikunci.'); msg.className = 'owner-msg ok';
    setTimeout(refreshModels, 1500);
  } }, 'Terapkan');
  body.replaceChildren(
    h('p', {}, h('b', {}, label(m.current)), m.effort ? ` · effort ${m.effort}` : '', ' ', h('span', { class: `tv-chip ${m.pinned ? 'warn' : 'ok'}` }, m.pinned ? '🔒 terkunci' : 'otomatis')),
    blocked.length ? h('p', { class: 'sub bad' }, blocked.join(' · ')) : null,
    sel, pin, h('div', { class: 'owner-actions' }, go), msg);
}

function manager(d) {
  const m = d.manager; if (!m) return h('div', {}, modelCard(), empty());
  return h('div', {}, modelCard(), lead(`Manager menyusun rencana kerja "${m.title}" dan membagi tugas ke ${m.plans.length} divisi. Berikut instruksi yang diberikan:`),
    m.plans.map((p) => card(h('h4', {}, p.agent), h('p', { class: 'pre' }, p.instruction))));
}
function researcher(d) {
  const r = d.research; if (!r) return empty();
  return h('div', {}, lead(`Researcher menemukan ${r.count} kandidat berita AI dari ${r.windowDays} hari terakhir.`),
    h('div', { class: 'tv-grid' }, r.items.map((i) => card(h('div', { class: 'row' }, h('span', { class: 'pill' }, i.source), h('span', { class: 'sub' }, i.date), i.offWhitelist ? h('span', { class: 'pill warn' }, 'di luar daftar sumber tepercaya') : null),
      h('b', {}, i.title), h('p', {}, i.summary), h('a', { href: i.url, target: '_blank', rel: 'noopener' }, 'buka sumber ↗')))));
}
function verifier(d) {
  const v = d.verification; if (!v) return empty();
  return h('div', {}, lead(`${v.verified} dari ${v.total} kandidat terverifikasi (URL, tanggal, dan klaim diperiksa).`),
    v.items.map((i) => card(h('div', { class: 'row' }, h('span', { class: `pill ${i.ok ? 'ok' : 'bad'}` }, i.ok ? '✔ terverifikasi' : '✖ ditolak'), h('b', {}, i.title)),
      i.notes.length ? h('ul', { class: 'tick' }, i.notes.map((n) => h('li', {}, n))) : null, i.reason ? h('p', { class: 'sub bad' }, i.reason) : null)));
}
function copywriter(d) {
  const c = d.copy; if (!c) return empty();
  return h('div', {}, lead(`Copywriter menulis ${c.slides.length} slide. Topik: ${c.topic}`), c.angle ? h('p', { class: 'sub' }, `Sudut pandang: ${c.angle}`) : null,
    h('div', { class: 'tv-grid' }, c.slides.map((s) => card(h('div', { class: 'row' }, h('span', { class: 'pill' }, `${s.index}. ${s.roleLabel}`)), h('b', {}, s.heading), h('p', {}, s.body),
      s.emphasis.length ? h('p', { class: 'sub' }, 'Ditekankan: ' + s.emphasis.join(', ')) : null, s.sources.length ? h('p', { class: 'sub' }, 'Sumber: ' + s.sources.join(', ')) : null))));
}
function designer(d) {
  const x = d.design; if (!x) return empty();
  return h('div', {}, lead(`Designer memilih tampilan ${x.variants.join(', ')} untuk ${x.slides.length} slide (hanya dari template brand kit).`),
    h('div', { class: 'tv-grid' }, x.slides.map((s) => card(s.image ? h('img', { class: 'tv-mini', src: img(s.image), alt: `Slide ${s.index}`, loading: 'lazy' }) : null,
      h('b', {}, `${s.index}. ${s.template}`, s.image ? h('a', { class: 'dlx', href: dlUrl(s.image), download: '', title: 'Unduh gambar slide ini' }, ' ⬇') : null), h('p', { class: 'sub' }, s.variant + (s.icon ? ` · ikon ${s.icon}` : '')), s.emphasis.length ? h('p', { class: 'sub' }, 'Ditekankan: ' + s.emphasis.join(', ')) : null))));
}
function qaHistoryCards(d) {
  return (d.qaHistory ?? []).map((r) => card(h('h4', {}, `Putaran QA sebelumnya (${r.round.replace(/^qa-putaran-/, '').replace(/-/g, ' ')})`),
    h('p', {}, r.passed ? '✔ Lolos' : `✖ Ditolak${r.fromScratch ? ', diminta dibuat dari awal' : r.returnTo.length ? `, dikembalikan ke: ${r.returnTo.join(', ')}` : ''}`),
    r.notes.length ? h('ul', {}, r.notes.map((n) => h('li', {}, n))) : null));
}
function qa(d) {
  const q = d.qa; if (!q) return (d.qaHistory ?? []).length ? h('div', {}, lead('Versi ini belum diperiksa QA. Riwayat putaran sebelumnya:'), ...qaHistoryCards(d)) : empty();
  return h('div', {}, ...qaHistoryCards(d), q.official ? card(h('span', { class: 'pill ok' }, '✔ Lolos QA resmi'), h('p', {}, q.official.label), q.official.contentHash ? h('p', { class: 'sub' }, `Hash isi paket: ${q.official.contentHash.slice(0, 16)}…`) : null) : card(h('span', { class: 'pill warn' }, 'Belum ada vonis QA resmi')),
    q.checks.length ? card(h('h4', {}, 'Pemeriksaan'), h('ul', { class: 'tick' }, q.checks.map((c) => h('li', { class: c.ok ? 'ok' : 'bad' }, `${c.ok ? '✔' : '✖'} ${c.label}`)))) : null,
    q.notes.length ? card(h('h4', {}, 'Catatan QA'), h('ul', {}, q.notes.map((n) => h('li', {}, n)))) : null);
}
