// Office View: renderer Canvas + kontroler. Semua gerakan datang dari applyEvent() (world.js) —
// event LIVE (bridge) dan event SIMULASI (replay) memakai jalur yang sama. Tidak ada aksi tulis, tidak ada LLM.
import { createWorld, applyEvent, stepWorld, describeEvent, addOwner, roomAt, thoughtOf } from './world.js';

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const W = 1920, H = 1080, SC = 3, FW = 16, FH = 32;
const $ = (id) => document.getElementById(id);

const app = { layout: null, world: null, mode: 'live', paused: false, speed: 1, epoch: 0, seq: 0, connected: true, simClock: 0, simEvents: [], simIdx: 0, simEndAt: 0, bgCache: new Map(), sprites: [], metrics: [], boardItems: [], boardImgs: new Map() };

// ───────── gambar statis (digambar sekali per mode, lalu di-cache) ─────────
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function label(c, text, x, y, size = 22, color = '#fff') { c.font = `700 ${size}px "Segoe UI", sans-serif`; c.fillStyle = color; c.textBaseline = 'top'; c.fillText(text, x, y); }

function drawDesk(c, d, desk) {
  c.fillStyle = '#00000040'; c.fillRect(d.x + 6, d.y + d.h, d.w, 10);
  c.fillStyle = '#9a7650'; c.fillRect(d.x, d.y, d.w, d.h);
  c.fillStyle = '#b48d62'; c.fillRect(d.x, d.y, d.w, 8);
  c.fillStyle = '#6e5238'; c.fillRect(d.x, d.y + d.h - 6, d.w, 6);
  c.fillStyle = '#d9d6cf'; c.fillRect(d.x + d.w / 2 - 30, d.y + d.h - 20, 60, 9); // keyboard
  c.fillStyle = '#3a2f24'; c.fillRect(d.x + 6, d.y + d.h, 10, 18); c.fillRect(d.x + d.w - 16, d.y + d.h, 10, 18);
}

function drawStatic(layout, mode) {
  const off = document.createElement('canvas'); off.width = W; off.height = H;
  const c = off.getContext('2d');
  c.fillStyle = '#10141d'; c.fillRect(0, 0, W, H);
  // koridor
  c.fillStyle = '#2b3140'; c.fillRect(0, layout.corridorY - 36, W, 72);
  c.fillStyle = '#353c4f'; for (let x = 0; x < W; x += 80) c.fillRect(x, layout.corridorY - 3, 40, 6);
  for (const r of layout.rooms) {
    c.fillStyle = r.floor; c.fillRect(r.x, r.y, r.w, r.h);
    c.fillStyle = '#ffffff0d'; for (let yy = r.y; yy < r.y + r.h; yy += 40) for (let xx = r.x + (((yy - r.y) / 40) % 2) * 40; xx < r.x + r.w; xx += 80) c.fillRect(xx, yy, 40, 40);
    c.lineWidth = 10; c.strokeStyle = r.glass ? '#9fd8ff99' : '#0d1017'; c.strokeRect(r.x, r.y, r.w, r.h);
    // celah pintu
    c.fillStyle = r.floor; const topRow = r.door.y <= layout.corridorY;
    c.fillRect(r.door.x - 48, (topRow ? r.y + r.h : r.y) - 8, 96, 16);
    // papan nama ruang
    c.fillStyle = '#0d1017cc'; rr(c, r.x + 12, r.y + 12, c.measureText(r.name).width + 40, 34, 8); c.fill();
    label(c, r.name, r.x + 24, r.y + 18, 20);
  }
  for (const p of layout.plants) { c.fillStyle = '#6b4a2f'; c.fillRect(p.x - 12, p.y + 14, 24, 22); c.fillStyle = '#2f8f4e'; c.beginPath(); c.arc(p.x, p.y, 22, 0, 7); c.fill(); c.fillStyle = '#3fb868'; c.beginPath(); c.arc(p.x - 8, p.y - 8, 12, 0, 7); c.fill(); }
  for (const d of layout.desks) drawDesk(c, d.desk, d);
  // meja owner + kotak approval
  drawDesk(c, layout.ownerDesk, null); label(c, 'OWNER', layout.ownerDesk.x + 12, layout.ownerDesk.y + 12, 16, '#2c1d10');
  const md = layout.desks.find((d) => d.key === 'manager'); if (md) label(c, 'MANAGER', md.desk.x + 12, md.desk.y + 12, 16, '#2c1d10');
  const b = layout.ownerBox; c.fillStyle = '#d6c7a1'; rr(c, b.x, b.y, b.w, b.h, 6); c.fill(); c.fillStyle = '#b8a673'; c.fillRect(b.x + 8, b.y + 8, b.w - 16, 12); label(c, 'approval · Manager', b.x - 30, b.y + b.h + 4, 13, '#ffe9b0');
  // rapat (kaca)
  const m = layout.meetingTable; c.fillStyle = '#7e8da0'; rr(c, m.x, m.y, m.w, m.h, 18); c.fill(); c.fillStyle = '#93a3b8'; rr(c, m.x + 8, m.y + 8, m.w - 16, 14, 8); c.fill();
  // lounge
  const s = layout.sofa; c.fillStyle = '#7a3f56'; rr(c, s.x, s.y, s.w, s.h, 14); c.fill(); c.fillStyle = '#93506b'; for (let i = 0; i < 3; i++) { rr(c, s.x + 10 + i * 96, s.y + 10, 88, s.h - 20, 10); c.fill(); }
  const cf = layout.coffee; c.fillStyle = '#2b2f3a'; rr(c, cf.x, cf.y, cf.w, cf.h, 8); c.fill(); c.fillStyle = '#e45858'; c.fillRect(cf.x + 12, cf.y + 12, 36, 14); c.fillStyle = '#fff'; c.fillRect(cf.x + 18, cf.y + 44, 24, 24); label(c, '☕', cf.x + 14, cf.y - 28, 24);
  // pojok bug
  const bd = layout.bugDesk; drawDesk(c, bd, null); c.fillStyle = '#facc15'; c.save(); c.translate(bd.x + 20, bd.y - 54); c.beginPath(); c.moveTo(0, 46); c.lineTo(26, 0); c.lineTo(52, 46); c.closePath(); c.fill(); c.restore(); label(c, '!', bd.x + 40, bd.y - 36, 26, '#111');
  c.strokeStyle = '#ef444488'; c.setLineDash([14, 10]); c.lineWidth = 4; c.strokeRect(1610, 900, 240, 62); c.setLineDash([]);
  // papan tayang
  const bo = layout.board;
  c.fillStyle = '#1b1f2b'; rr(c, bo.x - 14, bo.y - 14, bo.w + 28, bo.h + 28, 14); c.fill();
  c.strokeStyle = '#4b5568'; c.lineWidth = 3; rr(c, bo.x - 14, bo.y - 14, bo.w + 28, bo.h + 28, 14); c.stroke();
  c.fillStyle = '#080b12'; c.fillRect(bo.x, bo.y, bo.w, bo.h);
  c.fillStyle = '#2b3140'; c.fillRect(bo.x + bo.w / 2 - 50, bo.y + bo.h + 14, 100, 10); c.fillRect(bo.x + bo.w / 2 - 80, bo.y + bo.h + 24, 160, 8); // kaki TV
  // redupkan ruang tanpa sumber data nyata
  for (const r of layout.rooms) {
    const lit = r.live || (r.liveInSim && mode === 'sim');
    if (lit) continue;
    c.fillStyle = '#0a0d14b8'; c.fillRect(r.x, r.y, r.w, r.h);
    c.font = '700 26px "Segoe UI", sans-serif'; c.fillStyle = '#e6eaf2'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText((r.dimLabel ?? 'segera aktif').toUpperCase(), r.x + r.w / 2, r.y + r.h / 2); c.textAlign = 'left';
  }
  return off;
}

// ───────── gambar dinamis ─────────
function pill(c, text, x, y, size, bg, fg) {
  c.font = `600 ${size}px "Segoe UI", sans-serif`; const w = c.measureText(text).width + 16;
  c.fillStyle = bg; rr(c, x - w / 2, y, w, size + 8, 8); c.fill(); c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y + (size + 8) / 2 + 1); c.textAlign = 'left';
}
const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function drawChar(c, ch, w) {
  const img = app.sprites[ch.sprite % app.sprites.length];
  const row = ch.facing === 'down' ? 0 : ch.facing === 'up' ? 1 : 2;
  let frame = 1;
  const atDesk = !ch.moving && (ch.state === 'working') && ch.deskKey;
  if (ch.moving) frame = [0, 1, 2, 1][Math.floor(ch.clock * 8) % 4];
  else if (atDesk || (ch.isOwner && w.ownerCount > 0 && false)) frame = 3 + (Math.floor(ch.clock * 4) % 2);
  const bob = ch.state === 'paused' && !ch.moving ? Math.sin(ch.clock * 2) * 2 : ch.moving ? Math.abs(Math.sin(ch.clock * 8)) * -3 : 0;
  c.fillStyle = '#00000055'; c.beginPath(); c.ellipse(ch.x, ch.y + 2, 20, 7, 0, 0, 7); c.fill();
  if (img?.complete) {
    c.save();
    if (ch.facing === 'left') { c.translate(ch.x, 0); c.scale(-1, 1); c.drawImage(img, frame * FW, row * FH, FW, FH, -FW * SC / 2, ch.y - FH * SC + bob, FW * SC, FH * SC); }
    else c.drawImage(img, frame * FW, row * FH, FW, FH, ch.x - FW * SC / 2, ch.y - FH * SC + bob, FW * SC, FH * SC);
    c.restore();
  }
  if (ch.carry) { c.font = '28px "Segoe UI Emoji", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText('📄', ch.x + (ch.facing === 'left' ? -26 : 26), ch.y - 30 + bob); c.textAlign = 'left'; }
}
function drawTag(c, ch) {
  const text = ch.issue?.identifier ? `${ch.name} · ${ch.issue.identifier}` : ch.name;
  const sub = ch.isOwner ? '' : ch.role;
  pill(c, text, ch.x, ch.y - FH * SC - 30, 15, '#0d1017e6', '#fff');
  if (sub) { c.font = '600 11px "Segoe UI", sans-serif'; c.fillStyle = '#aab3c5'; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText(sub, ch.x, ch.y - FH * SC - 34); c.textAlign = 'left'; }
}
function wrap(c, text, maxW, maxLines) {
  const words = String(text).split(' '); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (c.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = trunc(lines[maxLines - 1], Math.max(8, lines[maxLines - 1].length - 1)) + '…'; }
  return lines;
}
// Bubble "berbicara dalam hati": selalu tampil saat tidak ada bubble bicara; teks dari log, tanpa LLM.
function drawThought(c, ch, placed = []) {
  if (ch.bubble) return;
  const txt = thoughtOf(ch, app.world.t);
  if (!txt) return;
  const baseY = ch.y - FH * SC - 62;
  c.font = 'italic 600 13px "Segoe UI", sans-serif';
  const lines = wrap(c, txt, 250, 2); const lh = 16;
  const w = Math.max(...lines.map((l) => c.measureText(l).width)) + 22, h = lines.length * lh + 12, x = Math.max(8, Math.min(1920 - w - 8, ch.x - w / 2));
  const rectAt = (yy) => ({ x, y: yy - h, w, h });
  const hit = (r1, r2) => r1.x < r2.x + r2.w && r1.x + r1.w > r2.x && r1.y < r2.y + r2.h && r1.y + r1.h > r2.y;
  let y = baseY;
  for (let k = 0; k < 4 && placed.some((r) => hit(r, rectAt(y))); k++) y -= h + 8;
  placed.push(rectAt(y));
  c.save(); c.globalAlpha = 0.92;
  c.fillStyle = '#e8eefc'; c.strokeStyle = '#7b8bb2'; c.lineWidth = 1.5; c.setLineDash([5, 3]);
  rr(c, x, y - h, w, h, 14); c.fill(); c.stroke(); c.setLineDash([]);
  c.fillStyle = '#e8eefc'; for (const [dx, dy, r] of [[-6, 4, 4], [-2, 11, 2.5]]) { c.beginPath(); c.arc(ch.x + dx, y + dy, r, 0, Math.PI * 2); c.fill(); c.stroke(); }
  c.fillStyle = '#2b3550'; c.textBaseline = 'middle'; c.textAlign = 'left';
  lines.forEach((l, i) => c.fillText(l, x + 11, y - h + 6 + lh * i + lh / 2));
  c.restore();
}
const BOARD_LABEL = { menunggu_approval: ['MENUNGGU', '#f59e0b'], disetujui: ['DISETUJUI', '#22c55e'], perlu_revisi: ['REVISI', '#ef4444'], berjalan: ['PRODUKSI', '#3b82f6'], terblokir: ['TERBLOKIR', '#ef4444'], draf: ['DRAF', '#64748b'] };
function boardImg(path) {
  let e = app.boardImgs.get(path);
  if (!e) { const im = new Image(); e = { im, ok: false }; im.onload = () => { e.ok = true; }; im.src = '/api/inspect/image?path=' + encodeURIComponent(path); app.boardImgs.set(path, e); }
  return e.ok ? e.im : null;
}
// TV: sampul tayangan terbaru + status. Hanya menggambar data yang dikembalikan server; klik membuka dashboard (tv.js).
function drawBoardLive(c, bo) {
  c.save();
  c.textBaseline = 'middle';
  c.font = '800 14px "Segoe UI", sans-serif'; c.fillStyle = '#9fb0cc'; c.textAlign = 'left';
  c.fillText('📺 PAPAN TAYANG', bo.x + 12, bo.y + 15);
  const items = app.boardItems ?? [];
  if (!items.length) { c.font = '600 16px "Segoe UI", sans-serif'; c.fillStyle = '#6b7a93'; c.textAlign = 'center'; c.fillText('Belum ada tayangan', bo.x + bo.w / 2, bo.y + bo.h / 2); c.restore(); return; }
  const lab = (it) => BOARD_LABEL[it.status?.key] ?? ['—', '#64748b'];
  // Tayangan utama (terbaru): sampul besar di kiri, judul + status di kanan
  const m = items[0], cw = 150, chh = 188, x0 = bo.x + 14, y0 = bo.y + 32;
  c.fillStyle = '#111827'; c.fillRect(x0, y0, cw, chh);
  const im = m.cover ? boardImg(m.cover) : null;
  if (im) c.drawImage(im, x0, y0, cw, chh); else { c.fillStyle = '#6b7a93'; c.font = '600 12px "Segoe UI"'; c.textAlign = 'center'; c.fillText('tanpa sampul', x0 + cw / 2, y0 + chh / 2); }
  c.strokeStyle = lab(m)[1]; c.lineWidth = 3; c.strokeRect(x0 - 1, y0 - 1, cw + 2, chh + 2);
  const tx = x0 + cw + 14, tw = bo.x + bo.w - 12 - tx;
  c.textAlign = 'left'; c.font = '700 14px "Segoe UI", sans-serif'; c.fillStyle = '#e6edf7';
  const words = String(m.title ?? m.prod).split(' '); const rows = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width <= tw || !cur) cur = t; else { rows.push(cur); cur = w; } }
  if (cur) rows.push(cur);
  rows.slice(0, 4).forEach((r, i) => c.fillText(i === 3 && rows.length > 4 ? r.slice(0, Math.max(4, r.length - 3)) + '…' : r, tx, y0 + 12 + i * 18));
  const [label, col] = lab(m);
  c.fillStyle = col; rr(c, tx, y0 + 92, Math.min(tw, 130), 24, 7); c.fill();
  c.fillStyle = '#0b0e14'; c.font = '800 12px "Segoe UI", sans-serif'; c.fillText(label, tx + 8, y0 + 104);
  c.fillStyle = '#9fb0cc'; c.font = '600 12px "Segoe UI", sans-serif'; c.fillText(m.prod + (m.slides ? ' · ' + m.slides + ' slide' : ''), tx, y0 + 130);
  // tayangan sebelumnya: kartu kecil
  items.slice(1, 3).forEach((it, i) => {
    const sx = tx + i * 56, sy = y0 + 146, sw = 48, sh = 60; const sm = it.cover ? boardImg(it.cover) : null;
    c.fillStyle = '#111827'; c.fillRect(sx, sy, sw, sh); if (sm) c.drawImage(sm, sx, sy, sw, sh);
    c.strokeStyle = lab(it)[1]; c.lineWidth = 2; c.strokeRect(sx, sy, sw, sh);
  });
  c.font = '600 11px "Segoe UI", sans-serif'; c.fillStyle = '#5b6b86'; c.textAlign = 'right'; c.fillText('klik TV untuk dashboard', bo.x + bo.w - 10, bo.y + bo.h - 12);
  c.restore();
}
function drawRing(c, ch) {
  c.save(); c.strokeStyle = '#60a5fa'; c.lineWidth = 4; c.shadowColor = '#60a5fa'; c.shadowBlur = 14;
  c.beginPath(); c.ellipse(ch.x, ch.y + 4, 36, 13, 0, 0, Math.PI * 2); c.stroke(); c.restore();
}
function drawBubble(c, ch) {
  if (!ch.bubble) return;
  drawSpeech(c, ch);
}
function drawSpeech(c, ch) {
  const y = ch.y - FH * SC - 66;
  c.font = '600 14px "Segoe UI", sans-serif';
  const lines = ch.bubble.text ? wrap(c, ch.bubble.text, 280, 3) : []; const lh = 18;
  const tw = lines.length ? Math.max(...lines.map((l) => c.measureText(l).width)) : 0;
  const w = 56 + tw + (lines.length ? 12 : 0), h = Math.max(44, lines.length * lh + 14), x = Math.max(8, Math.min(1920 - w - 8, ch.x - w / 2));
  c.fillStyle = '#ffffff'; c.strokeStyle = '#1b2336'; c.lineWidth = 2; c.setLineDash([]);
  rr(c, x, y - h, w, h, 12); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(ch.x - 8, y - 1); c.lineTo(ch.x + 8, y - 1); c.lineTo(ch.x, y + 10); c.closePath(); c.fill();
  c.font = '26px "Segoe UI Emoji", sans-serif'; c.textBaseline = 'middle'; c.fillStyle = '#111'; c.fillText(ch.bubble.emoji, x + 10, y - h / 2 + 2);
  c.font = '600 14px "Segoe UI", sans-serif';
  lines.forEach((l, i) => c.fillText(l, x + 46, y - h + 14 + lh * i + lh / 2 - 3));
}

function render() {
  const w = app.world; const L = app.layout;
  if (!w || !L) return;
  const key = app.mode;
  if (!app.bgCache.has(key)) app.bgCache.set(key, drawStatic(L, key));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(app.bgCache.get(key), 0, 0);
  // monitor menyala bila agent bekerja di mejanya
  for (const d of L.desks) {
    const working = [...w.chars.values()].some((ch) => ch.deskKey === d.key && ch.state === 'working');
    const mx = d.desk.x + d.desk.w / 2 - 34, my = d.desk.y - 34;
    ctx.fillStyle = '#1b1f2a'; ctx.fillRect(mx - 4, my - 4, 76, 50);
    ctx.fillStyle = working ? '#5ad1ff' : '#2a3140'; ctx.fillRect(mx, my, 68, 40);
    if (working) { ctx.fillStyle = '#ffffff55'; for (let i = 0; i < 4; i++) ctx.fillRect(mx + 6, my + 6 + i * 8, 20 + ((Math.floor(w.t * 3) + i * 7) % 30), 3); }
  }
  // kartu di papan tayang
  const bo = L.board;
  if (app.mode === 'live') drawBoardLive(ctx, bo);
  if (app.mode !== 'live') w.board.forEach((card, i) => { const bx = bo.x + 12 + (i % 2) * 142, by = bo.y + 12 + Math.floor(i / 2) * 76; ctx.fillStyle = '#fff'; ctx.fillRect(bx, by, 130, 64); ctx.fillStyle = '#16a34a'; ctx.fillRect(bx, by, 130, 12); ctx.fillStyle = '#111'; ctx.font = '600 12px "Segoe UI"'; ctx.textBaseline = 'top'; ctx.fillText(trunc(card.title, 20), bx + 6, by + 18); ctx.fillText('siap posting ✓', bx + 6, by + 40); });
  // badge owner
  const b = L.ownerBox;
  for (let i = 0; i < Math.min(w.ownerCount, 4); i++) { ctx.fillStyle = '#fff'; ctx.fillRect(b.x + 12 + i * 3, b.y - 6 - i * 6, 66, 12); }
  if (w.ownerCount > 0) { ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(b.x + b.w - 4, b.y + 2, 20, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '800 22px "Segoe UI"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(w.ownerCount), b.x + b.w - 4, b.y + 3); ctx.textAlign = 'left'; }
  // karakter urut kedalaman
  const list = [...w.chars.values()].sort((p, q) => p.y - q.y);
  for (const ch of list) drawChar(ctx, ch, w);
  const placed = [];
  for (const ch of list) if (ch.id === app.selectedId) drawRing(ctx, ch);
  for (const ch of list) { drawTag(ctx, ch); drawThought(ctx, ch, placed); drawBubble(ctx, ch); }
}

// ───────── log, banner, kontrol ─────────
function stamp() {
  if (app.mode === 'sim') { const s = Math.floor(app.simClock); return `sim ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
  return new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replaceAll('.', ':');
}
function addLog(text) {
  if (!text) return;
  const row = document.createElement('div'); const t = document.createElement('time');
  const sp = text.indexOf(' ', text.indexOf(' ') + 1); // "<stamp> pesan": stamp bisa berisi satu spasi (sim 00:18)
  const stampLen = app.mode === 'sim' ? sp : text.indexOf(' ');
  t.textContent = text.slice(0, stampLen); row.append(t, document.createTextNode(text.slice(stampLen + 1)));
  const log = $('log'); log.append(row); while (log.children.length > 14) log.firstChild.remove();
}
function setBanner() { $('banner').hidden = app.mode !== 'live' || app.connected; }
function setModeUi() {
  $('mode').textContent = app.mode === 'live' ? 'MODE: LIVE' : 'MODE: SIMULASI';
  $('mode').className = `mode ${app.mode}`;
  $('bLive').classList.toggle('on', app.mode === 'live'); $('bSim').classList.toggle('on', app.mode === 'sim');
  $('simnote').hidden = app.mode !== 'sim';
  for (const b of [$('bPlay'), ...document.querySelectorAll('#speed button')]) b.disabled = app.mode !== 'sim';
  setBanner();
}

async function jget(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }

function freshWorld(mode) { app.world = createWorld(app.layout); app.world.mode = mode; addOwner(app.world); }

async function startLive() {
  app.mode = 'live'; app.speed = 1; app.paused = false; $('log').replaceChildren(); setModeUi();
  freshWorld('live');
  try {
    const snap = await jget('/api/snapshot');
    app.epoch = snap.epoch; app.seq = snap.seq; app.connected = snap.connected;
    for (const ev of snap.events) applyEvent(app.world, ev, { instant: true });
    addLog(`${stamp()} keadaan terkini dibaca: ${[...app.world.chars.values()].filter((c) => !c.isOwner).length} agent`);
  } catch { app.connected = false; }
  setBanner();
}

async function pollLive() {
  if (app.mode !== 'live') return;
  try {
    const r = await jget(`/api/events?since=${app.seq}`);
    const wasDown = !app.connected;
    app.connected = r.connected;
    if (r.epoch !== app.epoch || (wasDown && r.connected)) { await startLive(); return; }
    app.seq = r.seq;
    for (const ev of r.events) {
      const t0 = performance.now();
      applyEvent(app.world, ev);
      addLog(describeEvent(app.world, ev, stamp()));
      app.metrics.push({ seq: ev.seq, type: ev.type, observedAt: ev.observedAt, appliedAt: Date.now(), agentId: ev.agentId ?? ev.from ?? null, state: ev.state ?? null, ms: performance.now() - t0 });
    }
  } catch { app.connected = false; }
  setBanner();
}

async function startSim() {
  app.mode = 'sim'; app.paused = false; $('log').replaceChildren(); setModeUi();
  freshWorld('sim');
  const { events } = await jget('/api/replay');
  app.simEvents = events; app.simIdx = 0; app.simClock = 0; app.simEndAt = Infinity;
  $('bPlay').textContent = '⏸';
}

function stepSim(dt) {
  if (app.mode !== 'sim' || app.paused) return;
  app.simClock += dt;
  while (app.simIdx < app.simEvents.length && app.simEvents[app.simIdx].t <= app.simClock) {
    const ev = app.simEvents[app.simIdx++];
    if (ev.type === 'end') { app.simEndAt = app.simClock + 6; continue; }
    applyEvent(app.world, ev, { instant: ev.silent === true });
    if (!ev.silent) addLog(describeEvent(app.world, ev, stamp()));
  }
  if (app.simClock >= app.simEndAt) { $('log').replaceChildren(); freshWorld('sim'); app.simIdx = 0; app.simClock = 0; app.simEndAt = Infinity; }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const k = app.mode === 'sim' ? (app.paused ? 0 : app.speed) : 1;
  if (app.world) { stepSim(dt * k); stepWorld(app.world, dt * k); }
  render();
  requestAnimationFrame(frame);
}

// ───────── init ─────────
async function init() {
  app.layout = await jget('/api/layout');
  app.sprites = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(im); im.src = `/assets/characters/char_${i}.png`; })));
  await startLive();
  setInterval(pollLive, 1000);
  const pollBoard = async () => { try { app.boardItems = (await jget('/api/inspect/board')).items ?? []; } catch { /* TV tetap menampilkan data terakhir */ } };
  pollBoard(); setInterval(pollBoard, 10000);
  requestAnimationFrame(frame);
}

$('bLive').onclick = () => startLive();
$('bSim').onclick = () => startSim();
$('bPlay').onclick = () => { app.paused = !app.paused; $('bPlay').textContent = app.paused ? '▶' : '⏸'; };
$('speed').onclick = (e) => { const b = e.target.closest('button[data-s]'); if (!b || b.disabled) return; app.speed = Number(b.dataset.s); document.querySelectorAll('#speed button').forEach((x) => x.classList.toggle('on', x === b)); };
$('bLegend').onclick = () => { $('legend').hidden = !$('legend').hidden; $('bLegend').classList.toggle('on', !$('legend').hidden); };
$('bLog').onclick = () => { $('log').hidden = !$('log').hidden; $('bLog').classList.toggle('on', !$('log').hidden); };
const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
$('bFull').onclick = toggleFull;
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'BUTTON' && e.key === ' ') return;
  if (e.key === 'f' || e.key === 'F') toggleFull();
  else if (e.key === ' ' && app.mode === 'sim') { e.preventDefault(); $('bPlay').click(); }
  else if (['1', '2', '4'].includes(e.key) && app.mode === 'sim') document.querySelector(`#speed button[data-s="${e.key}"]`)?.click();
});

// ───────── interaksi: klik karakter / kotak approval ─────────
const worldPoint = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) }; };
function hitTest(p) {
  if (!app.world || !app.layout) return null;
  let best = null;
  for (const ch of app.world.chars.values()) {
    if (Math.abs(p.x - ch.x) <= FW * SC / 2 + 6 && p.y <= ch.y + 8 && p.y >= ch.y - FH * SC - 8 && (!best || ch.y > best.y)) best = ch;
  }
  if (best) return { type: 'agent', name: best.name, id: best.id, isOwner: !!best.isOwner };
  const tv = app.layout.board;
  if (tv && p.x >= tv.x - 16 && p.x <= tv.x + tv.w + 16 && p.y >= tv.y - 16 && p.y <= tv.y + tv.h + 34) return { type: 'board' };
  const b = app.layout.ownerBox;
  if (b && p.x >= b.x - 40 && p.x <= b.x + b.w + 30 && p.y >= b.y - 50 && p.y <= b.y + b.h + 24) return { type: 'approvals' };
  return null;
}
cv.addEventListener('mousemove', (e) => { cv.style.cursor = hitTest(worldPoint(e)) ? 'pointer' : 'default'; });
cv.addEventListener('click', (e) => {
  const h = hitTest(worldPoint(e));
  app.selectedId = h?.type === 'agent' ? h.id : null;
  dispatchEvent(new CustomEvent('office:select', { detail: h ?? { type: 'none' } }));
});

// Untuk bukti/otomasi (read-only): keadaan karakter dan metrik jeda event→render
window.__office = {
  select: (name) => { const c = [...app.world.chars.values()].find((x) => x.name.toLowerCase() === String(name).toLowerCase()); app.selectedId = c ? c.id : null; return !!c; },
  clickAt: (x, y) => { const h = hitTest({ x, y }); app.selectedId = h?.type === 'agent' ? h.id : null; dispatchEvent(new CustomEvent('office:select', { detail: h ?? { type: 'none' } })); return h; },
  mode: () => app.mode,
  chars: () => [...app.world.chars.values()].map((c) => ({ id: c.id, name: c.name, state: c.state, x: Math.round(c.x), y: Math.round(c.y), room: roomAt(app.layout, c)?.id ?? 'koridor', moving: c.moving, carry: c.carry, issue: c.issue?.identifier ?? null, bubble: c.bubble?.emoji ?? null })),
  metrics: () => app.metrics.slice(),
  ownerCount: () => app.world.ownerCount,
  board: () => app.world.board.length,
  simClock: () => app.simClock,
  connected: () => app.connected,
};
init().catch((e) => { document.body.append(Object.assign(document.createElement('pre'), { textContent: `Gagal memulai Office View: ${e.message}` })); });
