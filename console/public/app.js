// Office Console (read-only). Semua teks dari server dirender dengan textContent, tidak pernah innerHTML.

const $ = (s) => document.querySelector(s);
const view = $('#view');
const REFRESH_MS = 10_000;

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const fmtNum = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n ?? 0));
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
const rel = (iso) => {
  if (!iso) return 'belum pernah';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return 'baru saja';
  if (s < 5400) return `${Math.round(s / 60)} mnt lalu`;
  if (s < 129600) return `${Math.round(s / 3600)} jam lalu`;
  return `${Math.round(s / 86400)} hari lalu`;
};
async function api(p) {
  const r = await fetch(p, { cache: 'no-store' });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
}

const STATUS = {
  idle: ['ok', 'siaga'], running: ['info', 'berjalan'], paused: ['warn', 'dijeda'], error: ['bad', 'error'], terminated: ['bad', 'berhenti'],
  todo: ['', 'todo'], backlog: ['', 'backlog'], in_progress: ['info', 'dikerjakan'], in_review: ['warn', 'menunggu owner'], blocked: ['bad', 'butuh manusia'], done: ['ok', 'selesai'], cancelled: ['', 'dibatalkan'],
};
const pill = (st) => { const [cls, label] = STATUS[st] ?? ['', st]; return h('span', { class: `pill ${cls}` }, label); };

function bar(value, max, label) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  const cls = pct >= 100 ? 'b' : pct >= 70 ? 'w' : '';
  return h('div', {}, h('div', { class: 'barlbl' }, h('span', { text: label }), h('span', { text: `${fmtNum(value)} / ${fmtNum(max)}` })), h('div', { class: `bar ${cls}`, role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: `width:${pct}%` })));
}
function stepper(workflow, status) {
  const firstOpen = workflow.steps.findIndex((s) => !s.done);
  return h('div', { class: 'steps', 'aria-label': 'Tahap workflow' }, workflow.steps.map((s, i) => h('span', { class: `step ${s.done ? 'done' : i === firstOpen && !['cancelled'].includes(status) ? 'now' : ''}`, text: `${s.done ? '✓ ' : ''}${s.label}` })));
}
function table(head, rows, numCols = []) {
  return h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, head.map((t, i) => h('th', { class: numCols.includes(i) ? 'num' : '', text: t })))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: numCols.includes(i) ? 'num' : '' }, c)))))));
}

let current = { route: '', timer: null, divisions: [] };

function setCrumbs(parts) {
  const el = $('#crumbs');
  el.replaceChildren(...parts.flatMap((p, i) => [i ? ' › ' : '', p.href ? h('a', { href: p.href, text: p.text }) : h('b', { text: p.text })]));
}
function setNav(divisions, active) {
  const nav = $('#nav');
  nav.replaceChildren(
    h('a', { href: '#/', 'aria-current': active === '/' ? 'page' : null }, '🏢 Office'),
    h('div', { class: 'grp' }, 'Divisions'),
    ...divisions.map((d) => h('a', { href: `#/d/${d.id}/ringkasan`, 'aria-current': active.startsWith(`/d/${d.id}`) ? 'page' : null }, `◼ ${d.name}`)),
  );
}

// ───────────────────────── Office ─────────────────────────
async function viewOffice() {
  const o = await api('/api/office');
  current.divisions = o.divisions;
  setNav(o.divisions, '/');
  setCrumbs([{ text: 'Office' }]);
  const healthy = o.health?.status === 'ok';
  const totalAgents = o.divisions.reduce((n, d) => n + d.agents, 0);
  const review = o.divisions.reduce((n, d) => n + (d.dashboard?.tasks?.open ?? 0), 0);
  return h('div', {},
    h('h1', { text: 'AI Agent Office' }),
    h('p', { class: 'lead', text: 'Ringkasan kantor digital Anda. Halaman ini hanya membaca; semua keputusan tetap di tangan owner.' }),
    h('div', { class: 'grid g4' },
      h('div', { class: 'card' }, h('div', { class: 'muted', text: 'Core platform' }), h('div', { class: 'stat' }, healthy ? 'Aktif' : 'Mati'), h('div', { class: 'muted', text: `Paperclip ${o.health?.version ?? '—'} · ${o.paperclip.replace('http://', '')}` })),
      h('div', { class: 'card' }, h('div', { class: 'muted', text: 'Division' }), h('div', { class: 'stat', text: String(o.divisions.length) }), h('div', { class: 'muted', text: 'terdaftar' })),
      h('div', { class: 'card' }, h('div', { class: 'muted', text: 'Agent' }), h('div', { class: 'stat', text: String(totalAgents) }), h('div', { class: 'muted', text: 'di semua division' })),
      h('div', { class: 'card' }, h('div', { class: 'muted', text: 'Task terbuka' }), h('div', { class: 'stat', text: String(review) }), h('div', { class: 'muted', text: 'belum selesai' })),
    ),
    h('h2', { text: 'Division' }),
    h('div', { class: 'grid g2' }, o.divisions.map((d) => {
      const dash = d.dashboard;
      return h('a', { class: 'card', href: `#/d/${d.id}/ringkasan` },
        h('h3', { text: d.name }),
        h('p', { class: 'muted', text: d.description ?? 'Division' }),
        h('div', { class: 'steps' },
          h('span', { class: 'step', text: `${d.agents} agent` }),
          h('span', { class: 'step', text: `${dash?.tasks?.open ?? 0} task terbuka` }),
          h('span', { class: 'step', text: `${dash?.tasks?.done ?? 0} selesai` }),
          dash?.agents?.paused ? h('span', { class: 'step', text: `${dash.agents.paused} dijeda` }) : null),
      );
    })),
    h('h2', { text: 'Alur kerja EdukasiAI' }),
    h('img', { class: 'pipeline', src: '/pipeline.png', alt: 'Diagram alur kerja EdukasiAI dari riset sampai approval owner' }),
    h('div', { class: 'note' }, 'Tidak ada posting otomatis. Setiap paket berhenti di "menunggu owner"; tombol approve/reject akan ditambahkan di tahap F2.1 (belum dibangun), jadi halaman ini belum bisa menyetujui apa pun.'),
  );
}

// ───────────────────────── Division ─────────────────────────
const TABS = [['ringkasan', 'Ringkasan'], ['agent', 'Agent'], ['task', 'Task & workflow'], ['pemakaian', 'Pemakaian token'], ['audit', 'Audit']];

async function viewDivision(id, tab) {
  const [o, d] = await Promise.all([api('/api/office'), api(`/api/division/${id}`)]);
  current.divisions = o.divisions;
  setNav(o.divisions, `/d/${id}`);
  setCrumbs([{ text: 'Office', href: '#/' }, { text: d.company.name }]);
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, label]) => h('a', { href: `#/d/${id}/${k}`, 'aria-current': k === tab ? 'page' : null }, label)));
  const body = { ringkasan: tabRingkasan, agent: tabAgent, task: tabTask, pemakaian: tabPemakaian, audit: tabAudit }[tab] ?? tabRingkasan;
  return h('div', {}, h('h1', { text: d.company.name }), h('p', { class: 'lead', text: d.company.description ?? 'Division' }), tabs, body(d));
}

function tabRingkasan(d) {
  const dash = d.dashboard;
  const inReview = d.tasks.filter((t) => t.status === 'in_review');
  return h('div', {},
    h('div', { class: 'grid g4' },
      h('div', { class: 'card' }, h('div', { class: 'muted', text: 'Agent' }), h('div', { class: 'stat' }, String(d.agents.length)), h('div', { class: 'muted', text: `${dash?.agents?.running ?? 0} berjalan · ${dash?.agents?.paused ?? 0} dijeda` })),
      h('div', { class: 'card' }, h('div', { class: 'muted', text: 'Task' }), h('div', { class: 'stat' }, String(d.tasks.length)), h('div', { class: 'muted', text: `${inReview.length} menunggu owner` })),
      h('div', { class: 'card' }, h('div', { class: 'muted', text: 'Run agent (total)' }), h('div', { class: 'stat' }, fmtNum(d.usage.total.runs)), h('div', { class: 'muted', text: `${d.usage.total.minutes} menit` })),
      h('div', { class: 'card' }, h('div', { class: 'muted', text: 'Token (masuk/keluar)' }), h('div', { class: 'stat' }, `${fmtNum(d.usage.total.input)} / ${fmtNum(d.usage.total.output)}`), h('div', { class: 'muted', text: 'langganan Codex · tanpa tagihan per token' })),
    ),
    h('h2', { text: 'Menunggu keputusan owner' }),
    inReview.length ? inReview.map(taskRow) : h('div', { class: 'empty', text: 'Tidak ada paket yang menunggu.' }),
    h('h2', { text: 'Aktivitas terbaru' }),
    auditList(d.audit.slice(0, 8)),
  );
}

function tabAgent(d) {
  const lim = d.usage.limits;
  return h('div', {},
    table(['Agent', 'Peran', 'Status', 'Adapter', 'Run hari ini', 'Menit hari ini', 'Heartbeat terakhir'],
      d.agents.map((g) => [
        h('div', {}, h('b', { text: g.name }), h('div', { class: 'muted', text: g.title ?? '' })),
        g.role, pill(g.status), h('span', { class: 'muted', text: `${g.adapter} · timeout ${g.timeoutSec ?? '—'}s` }),
        bar(g.today?.runs ?? 0, lim.maxRunsPerAgentPerDay, 'run'),
        bar(g.today?.minutes ?? 0, lim.maxMinutesPerAgentPerDay, 'menit'),
        h('span', { class: 'muted', text: rel(g.lastHeartbeatAt) }),
      ])),
    h('div', { class: 'note' }, `Batas harian per agent: ${lim.maxRunsPerAgentPerDay} run dan ${lim.maxMinutesPerAgentPerDay} menit (${lim.source}). Melewati batas → agent otomatis dijeda oleh guard plugin.`),
    d.agents.some((g) => g.pauseReason) ? h('div', { class: 'note warn' }, d.agents.filter((g) => g.pauseReason).map((g) => `${g.name}: ${g.pauseReason}`).join(' · ')) : null,
  );
}

function taskRow(t) {
  return h('a', { class: 'task', href: `#/i/${t.id}` },
    h('div', { class: 'row' }, h('span', { class: 'id', text: t.identifier }), h('span', { class: 't', text: t.title }), pill(t.status), t.assignee ? h('span', { class: 'muted', text: `→ ${t.assignee}` }) : null, h('span', { class: 'muted', text: rel(t.updatedAt) })),
    stepper(t.workflow, t.status),
  );
}
function tabTask(d) {
  return d.tasks.length ? h('div', {}, d.tasks.map(taskRow)) : h('div', { class: 'empty', text: 'Belum ada task.' });
}

function tabPemakaian(d) {
  const u = d.usage;
  return h('div', {},
    h('div', { class: 'grid g4' },
      h('div', { class: 'card' }, h('div', { class: 'muted', text: 'Token masuk' }), h('div', { class: 'stat', text: fmtNum(u.total.input) })),
      h('div', { class: 'card' }, h('div', { class: 'muted', text: 'Token keluar' }), h('div', { class: 'stat', text: fmtNum(u.total.output) })),
      h('div', { class: 'card' }, h('div', { class: 'muted', text: 'Token cache' }), h('div', { class: 'stat', text: fmtNum(u.total.cached) })),
      h('div', { class: 'card' }, h('div', { class: 'muted', text: 'Total run · menit' }), h('div', { class: 'stat' }, `${fmtNum(u.total.runs)} · ${u.total.minutes}`)),
    ),
    h('div', { class: 'note' }, 'Adapter codex_local memakai langganan Codex Anda, sehingga biaya per token tercatat 0 dan budget rupiah/dolar Paperclip tidak melindungi apa pun. Pembatas yang benar-benar bekerja adalah jumlah run dan durasi per agent per hari (di bawah).'),
    h('h2', { text: 'Per agent' }),
    table(['Agent', 'Run hari ini', 'Menit hari ini', 'Run total', 'Gagal', 'Token masuk', 'Token keluar', 'Cache'],
      u.agents.map((a) => [h('b', { text: a.name }), bar(a.todayRuns, u.limits.maxRunsPerAgentPerDay, 'batas'), bar(a.todayMinutes, u.limits.maxMinutesPerAgentPerDay, 'batas'), fmtNum(a.allRuns), a.failed ? h('span', { class: 'pill bad', text: String(a.failed) }) : '0', fmtNum(a.input), fmtNum(a.output), fmtNum(a.cached)]), [3, 4, 5, 6, 7]),
    h('h2', { text: '14 hari terakhir' }),
    u.days.length ? table(['Tanggal (WIB)', 'Run', 'Menit', 'Token masuk', 'Token keluar', 'Cache'], u.days.map((x) => [x.date, fmtNum(x.runs), String(x.minutes), fmtNum(x.input), fmtNum(x.output), fmtNum(x.cached)]), [1, 2, 3, 4, 5]) : h('div', { class: 'empty', text: 'Belum ada run.' }),
    d.dashboard?.costs ? h('div', { class: 'note warn' }, `Catatan: Paperclip mencatat ${d.dashboard.costs.monthSpendCents} sen terpakai bulan ini. Angka itu adalah cost-event uji sintetis dari F0.5 (bukan pemakaian nyata) dan dikecualikan dari KPI.`) : null,
  );
}

function auditList(items) {
  if (!items.length) return h('div', { class: 'empty', text: 'Belum ada catatan audit.' });
  return h('div', { class: 'card' }, h('ul', { class: 'tl' }, items.map((e) => h('li', {}, h('time', { text: fmtTime(e.at) }), h('span', { class: 'muted', text: e.actor }), h('span', {}, h('b', { text: e.action }), ' ', h('span', { class: 'muted', text: e.entity }))))));
}
const tabAudit = (d) => h('div', {}, h('p', { class: 'muted', text: 'Setiap tindakan pada task, agent, dan plugin (60 terbaru) beserta pelakunya.' }), auditList(d.audit));

// ───────────────────────── Issue ─────────────────────────
async function viewIssue(id) {
  const i = await api(`/api/issue/${id}`);
  const o = await api('/api/office');
  current.divisions = o.divisions;
  setNav(o.divisions, '/');
  const div = o.divisions.find((x) => x.name === i.company);
  setCrumbs([{ text: 'Office', href: '#/' }, div ? { text: i.company, href: `#/d/${div.id}/task` } : { text: i.company }, { text: i.issue.identifier }]);
  const handoff = i.documents.handoff;
  const hash = handoff?.match(/Hash isi paket \(sha256\): ([0-9a-f]{64})/)?.[1];
  const r = i.workflow.render;
  return h('div', {},
    h('h1', { text: `${i.issue.identifier} · ${i.issue.title}` }),
    h('p', {}, pill(i.issue.status)),
    h('h2', { text: 'Workflow' }), stepper(i.workflow, i.issue.status),
    h('h2', { text: 'Approval' }),
    i.issue.status === 'in_review'
      ? h('div', { class: 'card' }, h('h3', { text: 'Menunggu keputusan owner' }), h('p', { class: 'muted', text: 'Paket sudah lolos QA otomatis. Menyetujui atau menolak adalah hak owner. Tombol keputusan belum tersedia (tahap F2.1).' }), hash ? h('div', {}, h('div', { class: 'muted', text: 'Hash isi paket (sha256) — dicatat pada record approval nanti' }), h('div', { class: 'hash', text: hash })) : null)
      : h('div', { class: 'card muted', text: i.issue.status === 'done' ? 'Sudah diputuskan owner.' : 'Belum sampai tahap approval.' }),
    h('h2', { text: 'Output' }),
    r?.slides?.length
      ? h('div', {},
          r.visualQa ? h('p', { class: 'muted', text: `Cek visual otomatis: ${r.visualQa.passed ? 'lulus' : `GAGAL di slide ${r.visualQa.failed.join(', ')}`} · ${r.visualQa.pngCount} PNG` }) : null,
          r.contactSheet ? h('img', { class: 'sheet', src: `/api/file/${id}/contact-sheet.png`, alt: 'Contact sheet seluruh slide', loading: 'lazy' }) : null,
          h('h3', { text: 'Slide' }), h('div', { class: 'slides' }, r.slides.map((s) => h('a', { href: `/api/file/${id}/${s}`, target: '_blank', rel: 'noopener' }, h('img', { src: `/api/file/${id}/${s}`, alt: s, loading: 'lazy' })))))
      : h('div', { class: 'empty', text: 'Belum ada hasil render.' }),
    h('h2', { text: `Dokumen (${Object.keys(i.documents).length})` }),
    Object.keys(i.documents).length ? Object.entries(i.documents).map(([k, v]) => h('details', {}, h('summary', { text: k }), h('pre', { text: v }))) : h('div', { class: 'empty', text: 'Belum ada dokumen.' }),
    h('h2', { text: `Komentar (${i.comments.length})` }),
    i.comments.length ? i.comments.map((c) => h('div', { class: 'card', style: 'margin-bottom:8px' }, h('div', { class: 'muted', text: `${fmtTime(c.at)} · ${c.author}` }), h('pre', { text: c.body }))) : h('div', { class: 'empty', text: 'Belum ada komentar.' }),
  );
}

// ───────────────────────── Router ─────────────────────────
async function render() {
  const route = location.hash.replace(/^#/, '') || '/';
  current.route = route;
  clearTimeout(current.timer);
  let node;
  try {
    let m;
    if ((m = /^\/d\/([^/]+)(?:\/([a-z]+))?$/.exec(route))) node = await viewDivision(m[1], m[2] ?? 'ringkasan');
    else if ((m = /^\/i\/([^/]+)$/.exec(route))) node = await viewIssue(m[1]);
    else node = await viewOffice();
    const hs = await api('/api/health').catch(() => null);
    const ok = hs?.health?.status === 'ok';
    $('#health').className = `chip ${ok ? 'ok' : 'bad'}`;
    $('#health').textContent = ok ? 'Paperclip aktif' : 'Paperclip mati';
    $('#updated').textContent = `diperbarui ${new Date().toLocaleTimeString('id-ID')}`;
  } catch (e) {
    node = h('div', { class: 'card' }, h('h3', { text: 'Tidak dapat memuat data' }), h('p', { class: 'muted', text: e.message }), h('p', { class: 'muted', text: 'Pastikan Paperclip hidup: scripts\\start-paperclip.ps1 -Status' }));
    $('#health').className = 'chip bad';
    $('#health').textContent = 'Paperclip tidak terjangkau';
  }
  if (current.route === route) {
    view.replaceChildren(node);
    $('#side').classList.remove('open');
    if (!route.startsWith('/i/')) current.timer = setTimeout(render, REFRESH_MS);
  }
}
$('#burger').addEventListener('click', () => $('#side').classList.toggle('open'));
$('#sideFoot').textContent = 'Read-only · 127.0.0.1';
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
render();
