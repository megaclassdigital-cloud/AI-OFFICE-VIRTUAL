// away.js — tombol "Matikan aman" dan spanduk "Lanjutkan". Owner menekan tombol ini sebelum menutup/mematikan perangkat (sementara atau semalaman):
// pekerjaan baru berhenti, agen/pekerjaan yang sedang berjalan diselesaikan dulu, lalu seluruh sistem dimatikan tanpa memotong apa pun dan tanpa memakai token.
// Semua teks dari server dirender dengan textContent. Tersembunyi di monitor kedua/mode review (server menjawab owner nonaktif).
const $ = (sel) => document.querySelector(sel);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : String(v)); }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const getJson = async (p) => { try { const r = await fetch(p, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; } };
const post = async (p, body) => { try { const r = await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { ok: r.ok, data: await r.json().catch(() => ({})) }; } catch { return { ok: false, data: {} }; } };

const info = await getJson('/api/owner/info');
if (info?.enabled) init();

function init() {
  const btn = h('button', { type: 'button', id: 'bAway', title: 'Matikan sistem dengan aman sebelum menutup/mematikan laptop (tidak memakai token)', onclick: () => openModal() }, '🌙 Matikan aman');
  $('#bar .ctl')?.prepend(btn);

  // ───── spanduk: mode pergi / jeda aktif ─────
  const banner = h('div', { id: 'awayBanner', role: 'status', hidden: true });
  document.body.append(banner);
  const fmtTime = (ms) => new Date(ms).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', ':');
  async function refreshBanner() {
    if (document.hidden) return;
    const s = await getJson('/api/owner/away');
    if (!s || !['pergi', 'jeda', 'jeda-otomatis', 'menguras'].includes(s.phase)) { banner.hidden = true; return; }
    const text = s.phase === 'menguras' ? `🌙 Sedang mematikan aman… menunggu: ${(s.waiting ?? []).join(', ') || 'pekerjaan berjalan'}. Jangan tutup laptop dulu.`
      : s.phase === 'jeda-otomatis' ? `⏸ Dijeda otomatis (pemutus token): ${s.autoPause?.reason ?? 'terlalu banyak kegagalan beruntun'}. Tidak ada token terpakai.`
      : s.phase === 'pergi' ? `🌙 Mode pergi aktif sejak ${fmtTime(s.away.since)}${s.away.until ? `; lanjut otomatis ${fmtTime(s.away.until)}` : ''}. Tidak ada pekerjaan/token berjalan.`
      : '⏸ Pekerjaan dijeda. Tidak ada pekerjaan baru yang dimulai.';
    const go = h('button', { type: 'button', class: 'owner-approve', onclick: async () => { go.disabled = true; await post('/api/owner/away', { action: 'off' }); setTimeout(refreshBanner, 1500); } }, s.phase === 'menguras' ? '✖ Batalkan, lanjut bekerja' : '▶ Lanjutkan');
    banner.replaceChildren(h('span', {}, text), go); banner.hidden = false;
  }
  refreshBanner(); setInterval(refreshBanner, 15_000);

  // ───── jendela "Matikan aman" ─────
  const overlay = h('div', { id: 'awayModal', hidden: true, role: 'dialog', 'aria-label': 'Matikan aman' });
  document.body.append(overlay);
  const close = () => { overlay.hidden = true; };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });

  function openModal() {
    const hoursSel = h('select', { 'aria-label': 'Lanjut otomatis setelah', class: 'owner-stage' }, [['0', 'Sementara: saya lanjutkan sendiri'], ['9', 'Semalaman: lanjut otomatis 9 jam lagi'], ['2', '2 jam'], ['4', '4 jam'], ['6', '6 jam'], ['12', '12 jam'], ['24', '24 jam']].map(([v, t]) => h('option', { value: v }, t)));
    const powerSel = h('select', { 'aria-label': 'Aksi Windows setelah aman', class: 'owner-stage' }, [['', 'Biarkan Windows menyala (saya tutup sendiri)'], ['sleep', 'Tidurkan Windows setelah aman'], ['shutdown', 'Matikan Windows setelah aman (45 dtk untuk membatalkan)']].map(([v, t]) => h('option', { value: v }, t)));
    const msg = h('div', { class: 'owner-msg', role: 'status' });
    const progress = h('div', { class: 'away-progress' });
    const start = h('button', { type: 'button', class: 'owner-approve', onclick: async () => {
      start.disabled = true; msg.className = 'owner-msg'; msg.textContent = 'Memulai…';
      const r = await post('/api/owner/away', { action: 'on', hours: Number(hoursSel.value), power: powerSel.value || null });
      if (!r.ok) { start.disabled = false; msg.className = 'owner-msg bad'; msg.textContent = r.data?.error ?? 'Gagal memulai.'; return; }
      msg.textContent = ''; watch(progress, msg);
    } }, 'Mulai matikan aman');
    overlay.replaceChildren(h('div', { class: 'away-card' },
      h('div', { class: 'away-head' }, h('b', {}, '🌙 Matikan aman'), h('button', { type: 'button', class: 'tv-x', onclick: close, title: 'Tutup (Esc)' }, '✕')),
      h('p', { class: 'sub' }, 'Pekerjaan baru dihentikan. Agen yang sedang bekerja, render, dan posting diselesaikan dulu (maks. 20 menit), lalu seluruh sistem dimatikan tanpa memotong apa pun. Selama Anda pergi tidak ada token yang terpakai, dan sesudah menyala lagi agen tidak langsung bekerja sampai Anda menekan Lanjutkan (atau batas waktunya tiba).'),
      h('label', { class: 'sub' }, 'Berapa lama pergi?'), hoursSel,
      h('label', { class: 'sub' }, 'Setelah aman'), powerSel,
      h('div', { class: 'owner-actions' }, start, h('button', { type: 'button', class: 'ghost sm', onclick: close }, 'Batal')), progress, msg));
    overlay.hidden = false;
  }

  // Pantau kemajuan sampai server berhenti merespons (itu tanda sistem sudah mati = aman menutup laptop).
  async function watch(progress, msg) {
    let seen = false; let misses = 0;
    for (;;) {
      const s = await getJson('/api/owner/away');
      if (!s) { if (seen && ++misses >= 2) { progress.replaceChildren(h('p', { class: 'away-ok' }, '✅ Sistem sudah berhenti. Aman menutup atau mematikan laptop.')); msg.textContent = ''; return; } if (!seen && ++misses >= 6) { msg.className = 'owner-msg bad'; msg.textContent = 'Tidak bisa menghubungi server.'; return; } }
      else {
        misses = 0; if (['menguras', 'aman'].includes(s.phase)) seen = true;
        if (s.phase === 'menguras') progress.replaceChildren(h('p', {}, '⏳ Menunggu pekerjaan yang sedang berjalan selesai…'), h('ul', {}, (s.waiting ?? []).map((w) => h('li', {}, w))), h('p', { class: 'sub' }, 'Jangan tutup laptop dulu.'), h('button', { type: 'button', class: 'ghost sm', onclick: async () => { await post('/api/owner/away', { action: 'off' }); close(); setTimeout(refreshBanner, 1500); } }, '✖ Batalkan, lanjut bekerja'));
        else if (s.phase === 'aman') progress.replaceChildren(h('p', { class: 'away-ok' }, '✅ Semua pekerjaan selesai. Sistem berhenti dalam ±10 detik; laptop aman ditutup setelah jendela ini berhenti merespons.'));
        else if (s.phase === 'pergi') progress.replaceChildren(h('p', {}, '⏳ Memulai penghentian…'));
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
