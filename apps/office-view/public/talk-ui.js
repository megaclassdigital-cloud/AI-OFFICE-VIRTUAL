// Talk panel UI. Shown only when the server was started with --enable-talk.
const $ = (id) => document.getElementById(id);
let issueId = null; let timer = null;

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
  $('talkProd').addEventListener('click', async () => {
    const text = $('talkText').value.trim(); if (!text) { $('talkStatus').textContent = 'Tulis brief di kotak dulu.'; return; }
    if (await sendBrief('brief-panel', text)) $('talkText').value = '';
  });
  $('talkFileIn').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (f.size > 150000) { $('talkStatus').textContent = 'File terlalu besar (maks 150 KB).'; return; }
    await sendBrief(f.name, await f.text());
  });
  $('talkOut').addEventListener('toggle', () => { if ($('talkOut').open) loadFiles(); });
  $('talkForm').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $('talkText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } e.stopPropagation(); });
}
