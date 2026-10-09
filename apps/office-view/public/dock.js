// dock.js — right-hand dock of the Office View: Chat with Manager, Agent "memory" inspector, Approval inbox, plus the internet banner.
// All text from agents/Paperclip is data: it is only ever rendered with textContent (never innerHTML).
const $ = (id) => document.getElementById(id);
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* penyimpanan tidak tersedia: abaikan */ } },
};
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
const hhmm = (ms) => (ms ? new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':') : '');
const hhmmss = (ms) => (ms ? new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replaceAll('.', ':') : '');
const ago = (ms) => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 90 ? `${s} dtk lalu` : s < 5400 ? `${Math.round(s / 60)} mnt lalu` : `${Math.round(s / 3600)} jam lalu`; };
const AGENT_ICON = { Manager: '🧭', Researcher: '🔎', Verifier: '🛡️', Copywriter: '✍️', Designer: '🎨', QA: '✅', Owner: '👤' };
const RUN_COLOR = { running: 'run', succeeded: 'ok', failed: 'bad', timed_out: 'bad', error: 'bad', cancelled: 'mut' };

// ───────── internet banner (read-only, always on) ─────────
{
  const bar = h('div', { id: 'netbanner', hidden: true });
  $('stage')?.append(bar);
  const tick = async () => {
    const n = await jget('/api/network').catch(() => null);
    if (!n || !n.offline) { bar.hidden = true; return; }
    bar.textContent = `🔌 Internet terputus${n.since ? ' sejak ' + hhmm(n.since) : ''} — pekerjaan agent ditahan, lanjut otomatis saat online`;
    bar.hidden = false;
  };
  tick(); setInterval(tick, 5000);
}

// ───────── dock shell ─────────
const info = await jget('/api/talk/info').catch(() => ({ enabled: false }));
const state = { open: ls.get('dock.open', true), tab: ls.get('dock.tab', 'chat'), agent: ls.get('dock.agent', null), appr: null };

const tabs = [['chat', '💬 Manager'], ['agent', '🧑 Agen'], ['appr', '📥 Approval']];
const badge = h('span', { class: 'badge', hidden: true });
const dock = h('aside', { id: 'dock', 'aria-label': 'Panel samping' },
  h('header', {},
    h('nav', { class: 'tabs', role: 'tablist' }, tabs.map(([k, label]) => h('button', { type: 'button', role: 'tab', 'data-tab': k, onclick: () => setTab(k) }, label, k === 'appr' ? badge : null))),
    h('button', { type: 'button', class: 'x', title: 'Sembunyikan panel', 'aria-label': 'Sembunyikan panel', onclick: () => setOpen(false) }, '⟩')),
  h('section', { id: 'tab-chat' }), h('section', { id: 'tab-agent' }), h('section', { id: 'tab-appr' }));
const opener = h('button', { type: 'button', id: 'dockOpen', title: 'Buka panel', onclick: () => setOpen(true) }, '💬', h('span', { class: 'badge', id: 'openBadge', hidden: true }));
document.body.append(dock, opener);

function setOpen(v) {
  state.open = v; ls.set('dock.open', v);
  dock.classList.toggle('closed', !v); opener.hidden = v;
  document.documentElement.style.setProperty('--dockw', v ? 'min(420px, 38vw)' : '0px');
  if (v) refreshCurrent();
}
function setTab(k) {
  state.tab = k; ls.set('dock.tab', k);
  for (const b of dock.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === k);
  for (const [t] of tabs) $(`tab-${t}`).hidden = t !== k;
  refreshCurrent();
}
const refreshCurrent = () => { if (!state.open) return; if (state.tab === 'agent') loadAgent(); else if (state.tab === 'appr') loadAppr(); };

// ───────── Chat with Manager ─────────
const chat = $('tab-chat');
const pipe = h('div', { id: 'pipe', class: 'pipe' }, '🏭 …');
const thread = h('div', { id: 'thread', class: 'thread', 'aria-live': 'polite' });
const status = h('div', { id: 'cstatus', class: 'cstatus' });
const ta = h('textarea', { id: 'cta', rows: 1, maxlength: 4000, placeholder: info.enabled ? 'Tulis pesan untuk Manager…' : 'Chat tidak aktif (jalankan npm run office:talk)', disabled: !info.enabled });
const fileIn = h('input', { type: 'file', accept: '.md,.txt,.json', hidden: true });
const sendBtn = h('button', { type: 'button', class: 'send', onclick: () => send(), disabled: !info.enabled }, 'Kirim ➤');
chat.append(pipe, thread, status,
  h('div', { class: 'composer' }, ta,
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'ghost', title: 'Unggah brief produksi (.md/.txt)', onclick: () => fileIn.click(), disabled: !info.enabled }, '📎 Brief'),
      h('button', { type: 'button', class: 'ghost prod', title: 'Kirim isi kotak sebagai brief produksi penuh', onclick: () => produce(), disabled: !info.enabled }, '▶ Produksi'),
      sendBtn)), fileIn);

function msg(kind, who, text, at) {
  const m = h('div', { class: `msg ${kind}` }, h('div', { class: 'meta' }, who, at ? ` · ${hhmm(at)}` : ''), h('div', { class: 'body' }, text));
  thread.append(m); thread.scrollTop = thread.scrollHeight; return m;
}
msg('system', 'Manager', 'Halo, saya Manager. Tanyakan "sampai mana?" untuk status instan, atau beri arahan. ▶ Produksi memulai produksi penuh dari brief.');
ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; });
ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } e.stopPropagation(); });

let issueId = null; let pollTimer = null; const seen = new Set();
async function pollThread() {
  if (!issueId) return;
  try {
    const t = await jget(`/api/talk/thread?issue=${issueId}`);
    for (const c of t.comments) {
      const key = `${c.at}|${c.from}|${c.body}`; if (seen.has(key) || c.kind === 'owner') continue;
      seen.add(key); msg(c.kind === 'system' ? 'system' : 'agent', c.from, c.body, Date.parse(c.at));
    }
    status.textContent = `${t.issue.identifier} · ${t.issue.status}`;
  } catch { /* coba lagi pada tick berikut */ }
}
async function send() {
  const text = ta.value.trim(); if (!text || !info.enabled) return;
  sendBtn.disabled = true; status.textContent = 'Mengirim…';
  const r = await fetch('/api/talk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, issueId }) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok) { status.textContent = `Gagal: ${j.error ?? 'tidak terhubung'}`; sendBtn.disabled = false; return; }
  msg('me', 'Anda', text, Date.now()); ta.value = ''; ta.style.height = 'auto';
  if (j.kind === 'status') { msg('system', 'Status (instan)', j.answer, Date.now()); status.textContent = 'Jawaban instan dari data nyata, tanpa kuota.'; sendBtn.disabled = false; return; }
  issueId = j.issueId; status.textContent = 'Terkirim. Manager dibangunkan; balasan muncul di sini.';
  clearInterval(pollTimer); pollTimer = setInterval(pollThread, 4000); setTimeout(pollThread, 1500);
  setTimeout(() => { sendBtn.disabled = false; }, 5000);
}
async function sendBrief(name, text) {
  status.textContent = 'Mengirim brief produksi…';
  const r = await fetch('/api/talk/brief', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, text }) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  status.textContent = r && r.ok ? `✔ ${j.note}` : `Gagal: ${j.error ?? 'tidak terhubung'}`;
  if (r && r.ok) msg('system', 'Orkestrator', `Brief masuk antrean: ${j.file}`, Date.now());
  return !!(r && r.ok);
}
async function produce() {
  const text = ta.value.trim(); if (!text) { status.textContent = 'Tulis brief di kotak dulu.'; return; }
  if (!confirm('Ini memulai PRODUKSI PENUH (semua agent bekerja berurutan dan memakai kuota). Untuk sekadar bicara dengan Manager, pakai Kirim. Lanjutkan produksi?')) return;
  if (await sendBrief('brief-panel', text)) { msg('me', 'Anda (brief produksi)', text, Date.now()); ta.value = ''; ta.style.height = 'auto'; }
}
fileIn.addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (f.size > 150000) { status.textContent = 'File terlalu besar (maks 150 KB).'; return; }
  if (!confirm(`Unggah "${f.name}" sebagai BRIEF PRODUKSI? Semua agent akan bekerja berurutan dan memakai kuota.`)) return;
  await sendBrief(f.name, await f.text());
});
const STAGE_NAMES = ['Researcher', 'Verifier', 'Copywriter', 'Designer', 'QA'];
async function pollPipe() {
  const p = await jget('/api/talk/pipeline').catch(() => null); if (!p) return;
  const stage = p.job && p.job.stageIndex >= 0 ? ` · tahap ${p.job.stageIndex + 1}/5 ${STAGE_NAMES[p.job.stageIndex]}` : '';
  pipe.textContent = p.job ? `🏭 ${p.job.identifier}: ${p.job.phase}${stage}${p.queue ? ` · antrean ${p.queue}` : ''}` : `🏭 Tidak ada produksi berjalan${p.queue ? ` · antrean ${p.queue}` : ''}`;
  pipe.dataset.phase = p.job?.phase ?? 'idle';
}
pollPipe(); setInterval(pollPipe, 5000);

// ───────── Agent "memory" inspector ─────────
const agentTab = $('tab-agent');
const agentNames = ['Manager', 'Researcher', 'Verifier', 'Copywriter', 'Designer', 'QA'];
function pickAgent(name) { state.agent = name; ls.set('dock.agent', name); window.__office?.select?.(name); loadAgent(); }
async function loadAgent() {
  const chips = h('div', { class: 'chips' }, agentNames.map((n) => h('button', { type: 'button', class: 'chip' + (n === state.agent ? ' on' : ''), onclick: () => pickAgent(n) }, `${AGENT_ICON[n]} ${n}`)));
  if (!state.agent) { setKids(agentTab, chips, h('p', { class: 'hint' }, 'Klik karakter di peta, atau pilih agen di atas, untuk melihat sedang apa dia dan jejak kerjanya.')); return; }
  if (!agentTab.querySelector('.card')) setKids(agentTab, chips, h('p', { class: 'hint' }, `Memuat ${state.agent}…`)); // kerangka seketika, data menyusul
  let d; try { d = await jget(`/api/inspect/agent?name=${encodeURIComponent(state.agent)}`); } catch { d = { error: 'tidak terhubung' }; }
  if (state.tab !== 'agent') return;
  if (d.error) { setKids(agentTab, chips, h('p', { class: 'hint' }, `Gagal memuat: ${d.error}`)); return; }
  const a = d.agent;
  const head = h('div', { class: 'card head' },
    h('div', { class: 'avatar' }, AGENT_ICON[a.name] ?? '🙂'),
    h('div', {}, h('div', { class: 'title' }, a.name, h('span', { class: `pill ${a.status === 'running' ? 'run' : a.status === 'idle' ? 'ok' : 'bad'}` }, a.status)),
      h('div', { class: 'sub' }, `${a.title ?? a.role} · ${a.adapterType}${a.model ? ' · ' + a.model : ''}`),
      a.pauseReason ? h('div', { class: 'sub bad' }, `Dijeda: ${a.pauseReason}`) : null));
  const now = h('div', { class: 'card' }, h('h4', {}, 'Sedang mengerjakan'),
    d.issue ? h('div', {}, h('b', {}, d.issue.identifier), ' ', d.issue.title, h('div', { class: 'sub' }, `status issue: ${d.issue.status}${d.working ? ` · run berjalan ${Math.round(d.working.elapsedMs / 60000)} menit` : ''}`)) : h('div', { class: 'sub' }, 'Tidak ada tugas aktif.'));
  const tl = (d.timeline ?? []).slice().reverse();
  const timeline = h('div', { class: 'card' }, h('h4', {}, d.timelineFrom?.live ? '🟢 Aktivitas langsung' : 'Aktivitas run terakhir', d.timeline?.length ? h('span', { class: 'sub' }, ` (${d.timeline.length})`) : null),
    tl.length ? h('ol', { class: 'tl' }, tl.map((e) => h('li', {}, h('time', {}, hhmmss(e.ts)), h('span', { class: `tool ${e.kind}` }, e.tool), h('span', { class: 'lbl', title: e.label }, e.label)))) : h('div', { class: 'sub' }, 'Belum ada jejak aktivitas.'));
  const runs = h('div', { class: 'card' }, h('h4', {}, 'Riwayat run'),
    (d.runs ?? []).length ? h('ul', { class: 'runs' }, d.runs.map((r) => h('li', {}, h('span', { class: `dot ${RUN_COLOR[r.status] ?? 'mut'}` }), `${hhmm(Date.parse(r.startedAt))} · ${r.status}`, r.error ? h('div', { class: 'sub bad' }, r.error) : null))) : h('div', { class: 'sub' }, 'Belum ada.'));
  const cm = h('div', { class: 'card' }, h('h4', {}, 'Komentar terbaru dari agen ini'),
    (d.comments ?? []).length ? d.comments.map((c) => h('div', { class: 'cm' }, h('div', { class: 'sub' }, `${hhmm(Date.parse(c.at))}`), c.body)) : h('div', { class: 'sub' }, 'Belum ada.'));
  setKids(agentTab, chips, head, now, timeline, runs, cm);
}

// ───────── Approval inbox ─────────
const apprTab = $('tab-appr');
async function loadAppr() {
  if (state.appr) return;
  let d; try { d = await jget('/api/inspect/approvals'); } catch { d = null; }
  if (state.tab !== 'appr' || state.appr) return;
  if (!d || d.error) { setKids(apprTab, h('p', { class: 'hint' }, 'Tidak bisa memuat approval.')); return; }
  setBadge(d.items.length);
  const byProd = new Map();
  for (const it of d.items) { const k = it.production ?? '—'; if (!byProd.has(k)) byProd.set(k, []); byProd.get(k).push(it); }
  const blocks = [h('p', { class: 'hint' }, 'Hasil tiap tahap dikumpulkan Manager di sini. Klik item untuk melihat apa yang sudah dikerjakan, komentar agen, dan berkasnya.')];
  if (d.job) blocks.push(h('div', { class: 'card' }, h('b', {}, `Produksi ${d.job.identifier}`), ` · ${d.job.phase}${d.job.stageIndex >= 0 ? ` · tahap ${d.job.stageIndex + 1}/5` : ''}`,
    h('div', { class: 'row2' }, h('button', { type: 'button', class: 'ghost', onclick: () => openProd(d.job.identifier) }, '📁 Lihat paket produksi'))));
  if (!d.items.length) blocks.push(h('p', { class: 'hint' }, 'Tidak ada yang menunggu approval.'));
  for (const [prod, items] of byProd) {
    blocks.push(h('h4', { class: 'grp' }, prod === '—' ? 'Lainnya' : `Produksi ${prod}`, prod !== '—' ? h('button', { type: 'button', class: 'ghost sm', onclick: () => openProd(prod) }, '📁 berkas') : null));
    for (const it of items.slice().sort((p, q) => Number(q.package) - Number(p.package))) blocks.push(h('button', { type: 'button', class: 'item' + (it.package ? ' pkg' : ''), onclick: () => openIssue(it) }, it.package ? h('span', { class: 'pill ok' }, '📦 Paket final') : null, it.package ? ' ' : null, h('b', {}, it.stage ?? it.identifier), ' ', h('span', { class: 'sub' }, `${it.identifier}${it.assignee ? ' · ' + it.assignee : ''}${it.updatedAt ? ' · ' + ago(Date.parse(it.updatedAt)) : ''}`)));
  }
  setKids(apprTab, ...blocks);
}
function setBadge(n) { for (const b of [badge, $('openBadge')]) { b.textContent = String(n); b.hidden = !n; } }
const back = (label = '← Kembali') => h('button', { type: 'button', class: 'ghost', onclick: () => { state.appr = null; loadAppr(); } }, label);

async function openIssue(it) {
  state.appr = 'issue'; setKids(apprTab, back(), h('p', { class: 'hint' }, 'Memuat…'));
  let d; try { d = await jget(`/api/inspect/issue?id=${encodeURIComponent(it.id)}`); } catch { d = { error: 'gagal' }; }
  if (d.error) { setKids(apprTab, back(), h('p', { class: 'hint' }, d.error)); return; }
  setKids(apprTab, back(),
    h('div', { class: 'card' }, h('div', { class: 'title' }, `${d.identifier}`, h('span', { class: 'pill ok' }, d.status)), h('div', { class: 'sub' }, d.title), d.assignee ? h('div', { class: 'sub' }, `Penanggung jawab: ${d.assignee}`) : null),
    (d.documents ?? []).includes('handoff') ? decisionCard(d) : null,
    h('details', { class: 'card' }, h('summary', {}, 'Instruksi yang diberikan (input)'), h('pre', { class: 'pre' }, d.description || '(kosong)')),
    h('div', { class: 'card' }, h('h4', {}, 'Percakapan'), d.comments.length ? d.comments.map((c) => h('div', { class: `cm ${c.kind}` }, h('div', { class: 'sub' }, `${c.from} · ${hhmm(Date.parse(c.at))}`), c.body)) : h('div', { class: 'sub' }, 'Belum ada.')),
    d.production ? h('button', { type: 'button', class: 'ghost', onclick: () => openProd(d.production) }, `📁 Berkas produksi ${d.production}`) : null);
}
async function openProd(prod) {
  state.appr = 'prod'; setKids(apprTab, back(), h('p', { class: 'hint' }, 'Memuat berkas…'));
  let d; try { d = await jget(`/api/inspect/files?prod=${encodeURIComponent(prod)}`); } catch { d = { error: 'gagal' }; }
  const files = d.files ?? [];
  const imgs = files.filter((f) => f.kind === 'image').sort((p, q) => (q.path.includes('contact-sheet') ? 1 : 0) - (p.path.includes('contact-sheet') ? 1 : 0));
  const texts = files.filter((f) => f.kind === 'text');
  setKids(apprTab, back(), h('h4', { class: 'grp' }, `Paket produksi ${prod}`),
    imgs.length ? h('div', { class: 'gallery' }, imgs.map((f) => h('a', { href: `/api/inspect/image?path=${encodeURIComponent(f.path)}`, target: '_blank', rel: 'noopener', title: f.path }, h('img', { loading: 'lazy', src: `/api/inspect/image?path=${encodeURIComponent(f.path)}`, alt: f.path })))) : null,
    texts.length ? h('div', { class: 'files' }, texts.map((f) => fileRow(f))) : h('p', { class: 'hint' }, files.length ? '' : 'Belum ada berkas.'));
}
// Keputusan tetap dijalankan Owner di terminalnya (token owner di .env); UI hanya menyiapkan perintah, tidak pernah memutuskan.
function decisionCard(d) {
  const cmd = (t) => h('div', { class: 'cmd' }, h('code', {}, t), h('button', { type: 'button', class: 'ghost sm', onclick: async (e) => { try { await navigator.clipboard.writeText(t); e.target.textContent = 'tersalin ✔'; } catch { e.target.textContent = 'salin manual'; } } }, 'salin'));
  return h('div', { class: 'card decide' }, h('h4', {}, 'Keputusan Owner'),
    h('div', { class: 'sub' }, 'Paket sudah lolos QA dan diserahkan (ada dokumen handoff). Jalankan salah satu di terminal Anda, folder proyek:'),
    h('div', { class: 'sub' }, '✔ Setujui'), cmd(`node scripts/owner-decide.mjs approve --issue ${d.id}`),
    h('div', { class: 'sub' }, '✖ Tolak (catatan wajib; paket kembali ke Copywriter)'), cmd(`node scripts/owner-decide.mjs reject --issue ${d.id} --note "alasan"`),
    h('div', { class: 'sub' }, 'Belum pernah menyetel token owner? Jalankan sekali: node scripts/owner-approval.mjs init'));
}
function fileRow(f) {
  const body = h('pre', { class: 'pre', hidden: true });
  const row = h('div', { class: 'file' }, h('button', { type: 'button', class: 'item', onclick: async () => {
    if (!body.hidden) { body.hidden = true; return; }
    body.hidden = false; body.textContent = 'Memuat…';
    const r = await jget(`/api/inspect/file?path=${encodeURIComponent(f.path)}`).catch(() => ({ error: 'gagal' }));
    let txt = r.body ?? r.error ?? 'gagal';
    if (f.path.endsWith('.json')) { try { txt = JSON.stringify(JSON.parse(txt), null, 2); } catch { /* tampilkan apa adanya */ } }
    body.textContent = txt;
  } }, '📄 ', f.path.replace(/^runs\//, ''), h('span', { class: 'sub' }, ` ${(f.size / 1024).toFixed(1)} KB`)), body);
  return row;
}

// ───────── wiring ─────────
addEventListener('office:select', (e) => {
  const d = e.detail ?? {};
  if (d.type === 'agent' && !d.isOwner) { setOpen(true); state.agent = d.name; ls.set('dock.agent', d.name); setTab('agent'); }
  else if (d.type === 'agent' && d.isOwner) { setOpen(true); state.appr = null; setTab('appr'); }
  else if (d.type === 'approvals') { setOpen(true); state.appr = null; setTab('appr'); }
});
setInterval(() => { if (state.open && state.tab === 'agent' && state.agent) loadAgent(); }, 4000);
setInterval(() => { if (state.tab === 'appr' && !state.appr && state.open) loadAppr(); }, 8000);
(async () => { try { const d = await jget('/api/inspect/approvals'); setBadge(d.items.length); } catch { /* badge menyusul */ } })();
setInterval(async () => { try { const d = await jget('/api/inspect/approvals'); setBadge(d.items.length); } catch { /* abaikan */ } }, 15000);
setOpen(state.open); setTab(['chat', 'agent', 'appr'].includes(state.tab) ? state.tab : 'chat');
