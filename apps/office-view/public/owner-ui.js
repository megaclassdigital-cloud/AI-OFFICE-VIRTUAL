// owner-ui.js — panel keputusan Owner (Setujui / Tolak) dipakai dock dan TV. Semua teks dari server dirender dengan textContent.
// Bila tombol belum aktif (server tanpa --enable-owner atau PIN belum diatur) panel menampilkan petunjuk dan perintah terminal lama.
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const post = async (path, body) => {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
};
const getJson = async (path) => { try { return await (await fetch(path)).json(); } catch { return null; } };

const STAGE_OPTIONS = [
  ['', 'Manager yang menentukan (disarankan)'],
  ['copywriter', 'Paksa: mulai dari Copywriter (teks)'],
  ['designer', 'Paksa: mulai dari Designer (visual/aset)'],
];

/**
 * @param {{issueId:string, cmdFallback:(t:string)=>Node, wrapClass?:string}} p
 * @returns {Node} elemen panel; mengisi dirinya setelah /api/owner/info dibaca.
 */
export function ownerDecisionPanel({ issueId, cmdFallback, wrapClass = 'owner-panel' }) {
  const root = h('div', { class: wrapClass }, h('p', { class: 'sub' }, 'Memuat…'));
  const fallback = (why) => root.replaceChildren(
    h('p', { class: 'sub' }, why),
    h('p', { class: 'sub' }, '✔ Setujui'), cmdFallback(`node scripts/owner-decide.mjs approve --issue ${issueId}`),
    h('p', { class: 'sub' }, '✖ Tolak (alasan wajib; Manager yang menentukan divisi revisi)'), cmdFallback(`node scripts/owner-decide.mjs reject --issue ${issueId} --note "alasan"`));

  (async () => {
    const info = await getJson('/api/owner/info');
    if (!info?.enabled) return fallback('Tombol keputusan belum aktif (jalankan Office View dengan --enable-owner). Sementara, jalankan di terminal:');
    if (!info.pinSet) return fallback('PIN owner belum diatur: jalankan sekali "node scripts/owner-pin.mjs set" di terminal Anda, mulai ulang Office View, lalu tombol aktif. Sementara:');

    const pin = h('input', { type: 'password', autocomplete: 'off', placeholder: 'PIN owner', class: 'owner-pin', 'aria-label': 'PIN owner' });
    const note = h('textarea', { rows: '3', placeholder: 'Alasan tolak (wajib bila menolak): sebut slide/bagian yang salah', class: 'owner-note', 'aria-label': 'Alasan tolak' });
    const stage = h('select', { class: 'owner-stage', 'aria-label': 'Tahap tujuan revisi' }, STAGE_OPTIONS.map(([v, t]) => h('option', { value: v }, t)));
    const msg = h('div', { class: 'owner-msg', role: 'status' });
    const approve = h('button', { type: 'button', class: 'owner-approve' }, '✔ Setujui');
    const reject = h('button', { type: 'button', class: 'owner-reject' }, '✖ Tolak dan revisi');
    const busy = (b) => { approve.disabled = b; reject.disabled = b; };
    const say = (t, bad = false) => { msg.textContent = t; msg.className = `owner-msg ${bad ? 'bad' : 'ok'}`; };

    async function send(decision) {
      if (!pin.value) return say('Isi PIN owner dulu.', true);
      if (decision === 'reject' && !note.value.trim()) return say('Alasan tolak wajib diisi.', true);
      busy(true); say('Memproses…');
      const r = await post('/api/owner/decide', { issueId, decision, note: note.value, stage: stage.value || null, pin: pin.value });
      pin.value = '';
      busy(false);
      if (!r.ok) return say(r.data?.error ?? `Gagal (${r.status})`, true);
      if (decision === 'approve') { say('Disetujui. Paket publikasi disiapkan terpisah; tidak ada posting otomatis.'); approve.disabled = true; reject.disabled = true; return; }
      say(r.data.returnedTo ? `Ditolak. Manager menentukan divisi revisi (jendela batal 60 detik).` : 'Ditolak. Revisi dijadwalkan dari tahap pilihan Anda (jendela batal 60 detik).');
      approve.disabled = true; reject.disabled = true;
      watchCancel();
    }

    // Tombol batal selama jendela 60 detik (butuh PIN lagi)
    const cancelBox = h('div', { class: 'owner-cancel' });
    async function watchCancel() {
      const tick = async () => {
        const d = await getJson('/api/owner/routing');
        const p = d?.pending?.find((x) => x.issueId === issueId);
        if (!p || p.cancelled) { cancelBox.replaceChildren(); return false; }
        const left = Math.max(0, Math.ceil((p.readyAt - d.now) / 1000));
        if (left <= 0) { cancelBox.replaceChildren(h('span', { class: 'sub' }, 'Revisi sedang dijadwalkan.')); return false; }
        cancelBox.replaceChildren(h('button', { type: 'button', class: 'owner-cancel-btn', onclick: async () => {
          if (!pin.value) return say('Isi PIN owner untuk membatalkan.', true);
          const r = await post('/api/owner/cancel-revision', { identifier: p.identifier, pin: pin.value }); pin.value = '';
          say(r.ok ? 'Revisi dibatalkan; paket menunggu keputusan baru.' : (r.data?.error ?? 'Gagal membatalkan'), !r.ok);
        } }, `Batalkan revisi (${left} dtk)`));
        return true;
      };
      for (let i = 0; i < 70 && (await tick()); i++) await new Promise((res) => setTimeout(res, 1000));
    }

    approve.addEventListener('click', () => send('approve'));
    reject.addEventListener('click', () => send('reject'));
    root.replaceChildren(
      h('p', { class: 'sub' }, 'Paket sudah lolos QA dan diserahkan. Keputusan Anda dicatat dan terikat pada isi paket saat ini.'),
      pin, note, stage, h('div', { class: 'owner-actions' }, approve, reject), cancelBox, msg);
  })();
  return root;
}
