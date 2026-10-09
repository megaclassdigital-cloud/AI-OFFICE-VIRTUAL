// Talk panel UI. Shown only when the server was started with --enable-talk.
const $ = (id) => document.getElementById(id);
let issueId = null; let timer = null;

// Banner internet (selalu aktif, hanya-baca): terlihat di UI walau panel Manager tidak diaktifkan.
{
  const bar = document.createElement('div');
  bar.id = 'netbanner'; bar.hidden = true;
  bar.style.cssText = 'position:absolute;top:44px;left:50%;transform:translateX(-50%);z-index:40;background:#b45309;color:#fff;font:600 14px system-ui;padding:8px 16px;border-radius:10px;box-shadow:0 2px 10px #0008;';
  document.getElementById('stage')?.append(bar);
  const hhmm = (ms) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const tick = async () => {
    const n = await fetch('/api/network', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (!n || !n.offline) { bar.hidden = true; return; }
    bar.textContent = `🔌 Internet terputus${n.since ? ' sejak ' + hhmm(n.since) : ''} — pekerjaan agent ditahan, lanjut otomatis saat online`;
    bar.hidden = false;
  };
  tick(); setInterval(tick, 5000);
}

const info = await fetch('/api/talk/info', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ enabled: false }));
if (info.enabled) {
  $('talk').hidden = false;
  const addMsg = (cls, who, text) => {
    const d = document.createElement('div'); d.className = `m ${cls}`;
    const m = document.createElement('div'); m.className = 'meta'; m.textContent = who;
    const b = document.createElement('div'); b.textContent = text; // textContent: agent output is data, never HTML
    d.append(m, b); $('talkThread').append(d); $('talkThread').scrollTop = 1e9;
  };
  const render = (thread) => {
    $('talkThread').replaceChildren();
    for (const c of thread.comments) addMsg(c.kind === 'owner' ? 'me' : c.kind === 'system' ? 'system' : '', c.from, c.body);
    $('talkIssue').textContent = `${thread.issue.identifier} · ${thread.issue.status}`;
  };
  const poll = async () => {
    if (!issueId) return;
    try { render(await fetch(`/api/talk/thread?issue=${issueId}`, { cache: 'no-store' }).then((r) => r.json())); } catch { /* retry on next tick */ }
  };
  const send = async () => {
    const text = $('talkText').value.trim(); if (!text) return;
    $('talkSend').disabled = true; $('talkStatus').textContent = 'Mengirim…';
    const r = await fetch('/api/talk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, issueId }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { $('talkStatus').textContent = `Gagal: ${j.error ?? r.status}`; $('talkSend').disabled = false; return; }
    issueId = j.issueId; $('talkText').value = '';
    $('talkStatus').textContent = 'Terkirim. Manager dibangunkan; balasan muncul di sini.';
    await poll(); clearInterval(timer); timer = setInterval(poll, 4000);
    setTimeout(() => { $('talkSend').disabled = false; }, 5000);
  };
  const loadFiles = async () => {
    const j = await fetch('/api/talk/outputs', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ files: [] }));
    const box = $('talkFiles'); box.replaceChildren();
    if (!j.files.length) { box.textContent = 'Belum ada file hasil kerja.'; return; }
    for (const f of j.files) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = `${f.path} · ${(f.size / 1024).toFixed(1)} KB`;
      b.addEventListener('click', async () => {
        const r = await fetch('/api/talk/file?path=' + encodeURIComponent(f.path)).then((x) => x.json()).catch(() => ({}));
        $('talkFile').hidden = false; $('talkFile').textContent = r.body ?? r.error ?? 'gagal membaca'; // textContent: isi file = data
      });
      box.append(b);
    }
  };
  const sendBrief = async (name, text) => {
    $('talkStatus').textContent = 'Mengirim brief produksi…';
    const r = await fetch('/api/talk/brief', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, text }) });
    const j = await r.json().catch(() => ({}));
    $('talkStatus').textContent = r.ok ? `✔ ${j.note} (${j.file})` : `Gagal: ${j.error ?? r.status}`;
    return r.ok;
  };
  const STAGE_NAMES = ['Researcher', 'Verifier', 'Copywriter', 'Designer', 'QA'];
  const pipe = async () => {
    const p = await fetch('/api/talk/pipeline', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (!p) return;
    const stage = p.job && p.job.stageIndex >= 0 ? ` · tahap ${p.job.stageIndex + 1}/5 ${STAGE_NAMES[p.job.stageIndex]}` : '';
    $('talkPipe').textContent = p.job ? `🏭 Produksi ${p.job.identifier}: ${p.job.phase}${stage}${p.queue ? ` · antrean ${p.queue}` : ''}` : `🏭 Tidak ada produksi berjalan${p.queue ? ` · antrean ${p.queue}` : ''}`;
  };
  pipe(); setInterval(pipe, 5000);
  $('talkProd').addEventListener('click', async () => {
    const text = $('talkText').value.trim(); if (!text) { $('talkStatus').textContent = 'Tulis brief di kotak dulu.'; return; }
    if (!confirm('Ini memulai PRODUKSI PENUH (semua agent bekerja berurutan dan memakai kuota). Untuk sekadar berbicara dengan Manager, pakai tombol Kirim. Lanjutkan produksi?')) return;
    if (await sendBrief('brief-panel', text)) $('talkText').value = '';
  });
  $('talkFileIn').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (f.size > 150000) { $('talkStatus').textContent = 'File terlalu besar (maks 150 KB).'; return; }
    if (!confirm('Unggah "' + f.name + '" sebagai BRIEF PRODUKSI? Semua agent akan bekerja berurutan dan memakai kuota. (Untuk bicara biasa, pakai Kirim.)')) return;
    await sendBrief(f.name, await f.text());
  });
  $('talkOut').addEventListener('toggle', () => { if ($('talkOut').open) loadFiles(); });
  $('talkForm').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $('talkText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } e.stopPropagation(); });
}
