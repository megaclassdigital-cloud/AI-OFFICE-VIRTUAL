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
const TABS = [['show', '🎞️ Tayangan'], ['manager', '🧭 Manager'], ['researcher', '🔎 Researcher'], ['verifier', '🛡️ Verifier'], ['copywriter', '✍️ Copywriter'], ['designer', '🎨 Designer'], ['qa', '✅ QA']];

const st = { prod: null, rev: '', tab: 'show', data: null, slide: 0, sig: '' };
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
  try { board = await jget('/api/inspect/board'); } catch { /* pakai pilihan lama */ }
  if (force || !sel.options.length) {
    setKids(sel, ...board.items.map((i) => h('option', { value: i.prod }, `${i.label ?? i.prod} · ${i.title}`.slice(0, 70))));
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

const hhmm = (ms) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
const card = (...k) => h('div', { class: 'tv-card' }, ...k);
const empty = (t = 'Belum ada hasil dari divisi ini untuk produksi ini.') => h('p', { class: 'tv-empty' }, t);
const lead = (t) => h('p', { class: 'tv-lead' }, t);
const go = (d) => { const n = st.data?.slides?.length ?? 0; if (!n) return; st.slide = (st.slide + d + n) % n; render(); };

function render() {
  for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === st.tab);
  const d = st.data;
  chip.textContent = d?.status?.label ?? ''; chip.className = `tv-chip ${d?.status?.tone ?? ''}`;
  setKids(stages, ...(d?.stages ?? []).map((s) => h('div', { class: `stg ${s.state}`, title: s.label }, h('span', { class: 'dot' }), h('b', {}, s.agent), h('small', {}, s.state === 'done' && s.doneAt ? `selesai ${hhmm(s.doneAt)}` : s.state === 'running' ? 'sedang bekerja' : s.state === 'blocked' ? 'terblokir' : s.label))));
  if (!d) { setKids(main, empty(st.prod ? 'Memuat…' : 'Belum ada produksi yang bisa ditayangkan.')); return; }
  const view = { show, manager, researcher, verifier, copywriter, designer, qa }[st.tab];
  // replaceChildren(null) menulis teks "null": susun daftar anak tanpa nilai kosong.
  setKids(main, ...[d.paperclipOk === false ? h('div', { class: 'tv-warn' }, '⚠ Paperclip tidak terhubung: status produksi mungkin belum akurat. Hasil kerja di bawah dibaca langsung dari berkas.') : null, view(d)].filter(Boolean));
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

function manager(d) {
  const m = d.manager; if (!m) return empty();
  return h('div', {}, lead(`Manager menyusun rencana kerja "${m.title}" dan membagi tugas ke ${m.plans.length} divisi. Berikut instruksi yang diberikan:`),
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
function qa(d) {
  const q = d.qa; if (!q) return empty();
  return h('div', {}, q.official ? card(h('span', { class: 'pill ok' }, '✔ Lolos QA resmi'), h('p', {}, q.official.label), q.official.contentHash ? h('p', { class: 'sub' }, `Hash isi paket: ${q.official.contentHash.slice(0, 16)}…`) : null) : card(h('span', { class: 'pill warn' }, 'Belum ada vonis QA resmi')),
    q.checks.length ? card(h('h4', {}, 'Pemeriksaan'), h('ul', { class: 'tick' }, q.checks.map((c) => h('li', { class: c.ok ? 'ok' : 'bad' }, `${c.ok ? '✔' : '✖'} ${c.label}`)))) : null,
    q.notes.length ? card(h('h4', {}, 'Catatan QA'), h('ul', {}, q.notes.map((n) => h('li', {}, n)))) : null);
}
