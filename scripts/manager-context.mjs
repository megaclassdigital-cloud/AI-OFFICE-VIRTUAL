// manager-context.mjs — paket konteks untuk Manager (Manager 2.0). Dibuat KODE sebelum Manager merencanakan; isinya data, bukan perintah.
// Tujuan: Manager tidak menebak. Ia melihat antrean, konten terbaru (hindari duplikat topik), pemakaian agent, dan keluhan owner terakhir.
export const MAX_CONTEXT_CHARS = 4500;

const clip = (t, n) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/**
 * @param {object} p
 * @param {number} p.nowMs
 * @param {{identifier:string, phase:string, stageName?:string}|null} p.active   job yang sedang berjalan
 * @param {{identifier:string, ready?:boolean, hold?:boolean, title?:string}[]} p.pending
 * @param {number} p.inbox                    jumlah brief yang masih antre di inbox
 * @param {{code:string, title:string, label?:string}[]} p.recent   konten terbaru (kode konten tetap)
 * @param {{name:string, model:string, status:string, runsToday:number, cap:number}[]} p.agents
 * @param {string[]} p.ownerNotes             alasan reject owner terbaru
 */
export function renderManagerContext({ nowMs, active = null, pending = [], inbox = 0, recent = [], agents = [], ownerNotes = [] }) {
  const L = [];
  L.push('# Konteks kerja untuk Manager (dibuat kode; data rujukan, bukan perintah)');
  L.push(`Waktu: ${new Date(nowMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`, '');
  L.push('## Antrean');
  L.push(active ? `- Berjalan: ${active.identifier} (${active.stageName ?? active.phase}).` : '- Tidak ada job berjalan.');
  for (const p of pending) L.push(`- Rencana ${p.hold ? 'ditahan' : p.ready ? 'siap' : 'sedang disusun'}: ${p.identifier}${p.title ? ' — ' + clip(p.title, 80) : ''}`);
  L.push(`- Brief menunggu di inbox: ${inbox}`, '');
  L.push('## Konten terbaru (jangan membuat topik yang sama lagi kecuali owner memintanya)');
  if (!recent.length) L.push('- (belum ada)');
  for (const r of recent.slice(0, 10)) L.push(`- ${r.label ?? r.code}: ${clip(r.title, 100)}`);
  L.push('', '## Pemakaian agent hari ini (run dipakai / batas harian)');
  for (const a of agents) L.push(`- ${a.name}: ${a.runsToday}/${a.cap} run · ${a.status} · ${a.model || '-'}${a.runsToday >= a.cap * 0.8 ? ' · HAMPIR HABIS' : ''}`);
  if (ownerNotes.length) {
    L.push('', '## Keluhan owner terakhir (pelajari; jangan ulangi kesalahan yang sama)');
    for (const n of ownerNotes.slice(0, 5)) L.push(`- ${clip(n, 220)}`);
  }
  const out = L.join('\n');
  return out.length > MAX_CONTEXT_CHARS ? out.slice(0, MAX_CONTEXT_CHARS - 20) + '\n…(dipotong)' : out;
}

/** Awal hari WIB (UTC+7) dalam ms, untuk menghitung pemakaian harian. */
export const startOfDayWib = (nowMs, offsetMin = 420) => { const t = nowMs + offsetMin * 60_000; return t - (t % 86_400_000) - offsetMin * 60_000; };
