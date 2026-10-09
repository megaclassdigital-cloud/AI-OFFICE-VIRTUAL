// Logika dunia Office View: murni (tanpa DOM) supaya bisa diuji. Satu-satunya jalur perubahan adalah applyEvent():
// event LIVE (dari bridge) dan event SIMULASI (dari replay) memakai jalur yang sama.

export const SPEED = 240; // piksel logis per detik
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createWorld(layout) {
  return { layout, t: 0, chars: new Map(), ownerCount: 0, ownerBubble: null, board: [], log: [], mode: 'live' };
}

export function roomAt(layout, p) {
  return layout.rooms.find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) ?? null;
}

function dedupe(path) {
  const out = [];
  for (const p of path) if (!out.length || dist(out[out.length - 1], p) > 1) out.push({ x: p.x, y: p.y });
  return out;
}

/** Jalur jalan dari titik `from` ke `to`: keluar ruang lewat pintu, lewat koridor, masuk ruang tujuan. */
export function planPath(layout, from, to) {
  const a = roomAt(layout, from);
  const b = roomAt(layout, to);
  const cy = layout.corridorY;
  if (a && b && a.id === b.id) return dedupe([{ x: from.x, y: a.aisleY }, { x: to.x, y: a.aisleY }, to]);
  const pts = [];
  if (a) pts.push({ x: from.x, y: a.aisleY }, { x: a.door.x, y: a.aisleY }, a.door);
  pts.push({ x: a ? a.door.x : from.x, y: cy });
  pts.push({ x: b ? b.door.x : to.x, y: cy });
  if (b) pts.push(b.door, { x: b.door.x, y: b.aisleY }, { x: to.x, y: b.aisleY });
  pts.push(to);
  return dedupe(pts);
}

export function deskKeyOf(layout, agent) {
  const keys = new Set(layout.desks.map((d) => d.key));
  const name = String(agent.name ?? '').toLowerCase();
  if (keys.has(name)) return name;
  const viaRole = layout.roleToDeskKey[String(agent.role ?? '').toLowerCase()];
  return viaRole && keys.has(viaRole) ? viaRole : null;
}

function deskOf(world, c) {
  return world.layout.desks.find((d) => d.key === c.deskKey) ?? null;
}

export function homeOf(world, c) {
  const L = world.layout;
  if (c.isOwner) return L.ownerSeat;
  const slot = (arr) => arr[c.slot % arr.length];
  if (c.state === 'failed' || c.state === 'alert') return slot(L.bugSlots);
  const desk = deskOf(world, c);
  if ((c.state === 'working' || c.state === 'paused') && desk) return desk.seat;
  return slot(L.loungeSlots);
}

/** Slot Lounge/Pojok Bug berikutnya yang belum dipakai karakter lain (tidak ada dua karakter menumpuk). */
function freeSlot(world, c) {
  const n = world.layout.loungeSlots.length;
  const taken = new Set([...world.chars.values()].filter((o) => o !== c && !o.isOwner).map((o) => o.slot % n));
  for (let k = 1; k <= n; k++) { const idx = (c.slot + k) % n; if (!taken.has(idx)) return idx; }
  return c.slot;
}

function ensureChar(world, ev) {
  let c = world.chars.get(ev.agentId);
  if (!c) {
    const idx = world.chars.size;
    c = {
      id: ev.agentId, name: ev.name ?? ev.agentId, role: ev.role ?? '', isOwner: false, sprite: idx % 6, slot: idx,
      deskKey: null, state: 'idle', issue: null, x: 0, y: 0, path: [], queue: [], carry: false, facing: 'down', bubble: null, wait: 0, wander: 6 + (idx % 5), clock: 0, moving: false,
    };
    c.deskKey = deskKeyOf(world.layout, c);
    const h = homeOf(world, c);
    c.x = h.x; c.y = h.y;
    world.chars.set(c.id, c);
  }
  if (ev.name) c.name = ev.name;
  if (ev.role) c.role = ev.role;
  c.deskKey = deskKeyOf(world.layout, c);
  return c;
}

export function addOwner(world) {
  const L = world.layout;
  world.chars.set('owner', { id: 'owner', name: 'Owner', role: 'owner', isOwner: true, sprite: 5, slot: 0, deskKey: null, state: 'idle', issue: null, x: L.ownerSeat.x, y: L.ownerSeat.y, path: [], queue: [], carry: false, facing: 'up', bubble: null, wait: 0, wander: 99, clock: 0, moving: false });
}

function say(world, c, emoji, text, secs = 3) {
  c.bubble = { emoji, text: text ?? '', until: world.t + secs };
}
function goHome(world, c) {
  const h = homeOf(world, c);
  if (dist(c, h) > 3) c.path = planPath(world.layout, c, h);
}
function standNear(world, key) {
  const d = world.layout.desks.find((x) => x.key === key);
  return d ? d.stand : world.layout.loungeSlots[0];
}

const VERB = {
  researcher: 'Mencari kandidat berita AI',
  verifier: 'Memeriksa sumber, URL, dan tanggal',
  copywriter: 'Menulis draf teks slide',
  designer: 'Memilih template dan warna',
  qa: 'Memeriksa hasil render slide',
  manager: 'Menyusun arahan dan brief',
};
const fmtElapsed = (sec) => (sec < 60 ? `${Math.max(1, Math.floor(sec))}d` : `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}d`);

/** Teks "berbicara dalam hati" dari data log (tanpa LLM, tanpa token). Kosong untuk Owner. */
export function thoughtOf(c, t) {
  if (c.isOwner) return '';
  const ref = c.issue?.identifier ? ` (${c.issue.identifier})` : '';
  const el = c.since !== undefined ? ` · ${fmtElapsed(t - c.since)}` : '';
  if (c.carry) return `Membawa dokumen${ref} ke rekan`;
  if (c.state === 'working') {
    if (c.moving) return `Menuju meja${ref}…`;
    return `${VERB[c.deskKey] ?? VERB[String(c.role ?? '').toLowerCase()] ?? 'Mengerjakan tugas'}${ref}${el}`;
  }
  if (c.state === 'failed') return `Run gagal${c.reason ? ': ' + c.reason : ''} — menunggu dipulihkan`;
  if (c.state === 'alert') return `Butuh keputusan manusia${c.reason ? ': ' + c.reason : ''}`;
  if (c.state === 'paused') return `Dijeda${c.reason ? ' (' + c.reason + ')' : ''} — tidak bekerja`;
  return c.moving ? 'Berjalan…' : 'Istirahat, menunggu tugas';
}

function title(issue) {
  if (!issue) return '';
  return issue.title ? `${issue.identifier ?? ''} ${issue.title}`.trim() : issue.identifier ?? '';
}

/** Terapkan satu event office. `instant` = pindahkan tanpa berjalan (dipakai saat snapshot awal). */
export function applyEvent(world, ev, { instant = false } = {}) {
  const L = world.layout;
  switch (ev.type) {
    case 'agent.state': {
      const c = ensureChar(world, ev);
      const prev = c.state;
      if (c.state !== ev.state || c.since === undefined) c.since = world.t;
      c.state = ev.state;
      c.reason = ev.reason;
      c.issue = ev.issue ?? null;
      if (instant) {
        const h = homeOf(world, c);
        c.x = h.x; c.y = h.y; c.path = []; c.queue = []; c.carry = false;
      } else if (!c.queue.length) {
        c.path = [];
        goHome(world, c);
      }
      if (ev.state === 'working') say(world, c, '⌨️', `Mulai: ${title(ev.issue)}`, 5);
      else if (ev.state === 'failed') say(world, c, '🐞', ev.reason ?? 'run gagal', 8);
      else if (ev.state === 'alert') say(world, c, '⚠️', ev.reason ?? 'butuh manusia', 8);
      else if (ev.state === 'paused') say(world, c, '😴', ev.reason ?? 'dijeda', 8);
      else if (ev.state === 'idle' && prev !== 'idle' && !instant) say(world, c, '☕', '', 3);
      break;
    }
    case 'handoff': {
      const from = world.chars.get(ev.from);
      const to = world.chars.get(ev.to);
      if (!from || !to) break;
      const target = to.deskKey ? standNear(world, to.deskKey) : L.loungeSlots[0];
      from.queue = [{ go: target, carry: true }, { bubbleBoth: ev.emoji ?? '📄', other: to.id, text: ev.emoji === '❌' ? `${to.name}, perlu revisi: ${title(ev.issue)}` : `${to.name}, ini untukmu: ${title(ev.issue)}`, otherText: ev.emoji === '❌' ? 'Baik, aku perbaiki.' : `Diterima dari ${from.name}, kukerjakan.` }, { wait: 1.2 }, { drop: true }];
      from.path = [];
      break;
    }
    case 'comment': {
      const c = world.chars.get(ev.agentId);
      const quote = ev.excerpt ? `${ev.excerpt}` : title(ev.issue);
      if (ev.fromOwner) {
        const o = world.chars.get('owner');
        if (o) say(world, o, '🗣️', `Arahan: ${quote}`, 6);
        if (c) say(world, c, '👂', `Diterima: ${title(ev.issue)}`, 6);
      } else if (c) say(world, c, '💬', quote, 6);
      break;
    }
    case 'deliver': {
      const c = world.chars.get(ev.agentId);
      if (!c) break;
      c.queue = [{ go: L.ownerDrop, carry: true }, { owner: ev.count ?? null }, { bubble: '✋', text: `Paket siap, menunggu keputusanmu: ${title(ev.issue)}`, s: 5 }, { wait: 1.5 }, { drop: true }];
      c.path = [];
      break;
    }
    case 'owner.queue':
      world.ownerCount = ev.count ?? 0;
      break;
    case 'owner.decide': {
      const o = world.chars.get('owner');
      if (o) say(world, o, ev.decision === 'rejected' ? '↩️' : '🎉', ev.decision === 'rejected' ? 'ditolak' : 'disetujui', 4);
      break;
    }
    case 'board.add':
      world.board.push({ title: ev.title ?? '', at: world.t });
      if (world.board.length > 4) world.board.shift();
      break;
    case 'board.clear':
      world.board = [];
      break;
    case 'reset':
      world.chars.clear(); world.ownerCount = 0; world.board = []; world.log = []; addOwner(world);
      break;
    default:
      break;
  }
}

function runStep(world, c, step) {
  if (step.go) { c.path = planPath(world.layout, c, step.go); if (step.carry) c.carry = true; return false; }
  if (step.bubbleBoth) {
    say(world, c, step.bubbleBoth, step.text, 4.5);
    const o = world.chars.get(step.other);
    if (o) say(world, o, '💬', step.otherText ?? step.text, 4.5);
    return true;
  }
  if (step.bubble) { say(world, c, step.bubble, step.text, step.s ?? 2.5); return true; }
  if (step.owner !== undefined) { if (step.owner !== null) world.ownerCount = step.owner; return true; }
  if (step.wait) { c.wait = step.wait; return false; }
  if (step.drop) { c.carry = false; return true; }
  return true;
}

export function stepWorld(world, dt) {
  world.t += dt;
  for (const c of world.chars.values()) {
    c.clock += dt;
    if (c.bubble && c.bubble.until <= world.t) c.bubble = null;
    c.moving = false;
    if (c.path.length) {
      const target = c.path[0];
      const d = dist(c, target);
      const stepLen = SPEED * dt;
      if (d <= stepLen) { c.x = target.x; c.y = target.y; c.path.shift(); }
      else { c.x += ((target.x - c.x) / d) * stepLen; c.y += ((target.y - c.y) / d) * stepLen; }
      const dx = target.x - c.x; const dy = target.y - c.y;
      c.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      c.moving = true;
      continue;
    }
    if (c.wait > 0) { c.wait -= dt; continue; }
    if (c.queue.length) {
      const step = c.queue.shift();
      const instantDone = runStep(world, c, step);
      if (!instantDone) continue;
      continue;
    }
    // Tidak ada tugas: pastikan berada di tempatnya; pose menurut state
    const h = homeOf(world, c);
    if (dist(c, h) > 3) { c.path = planPath(world.layout, c, h); continue; }
    if (c.state === 'working' || c.state === 'paused' || c.isOwner) c.facing = 'up';
    else if (c.state === 'idle') {
      c.wander -= dt;
      if (c.wander <= 0) {
        c.wander = 7 + ((c.slot * 3 + Math.floor(world.t)) % 6);
        c.slot = freeSlot(world, c);
      } else c.facing = 'down';
    } else c.facing = 'down';
  }
}

/** Kalimat log berbahasa Indonesia untuk satu event (null = tidak dicatat). */
export function describeEvent(world, ev, stamp) {
  const nm = (id) => world.chars.get(id)?.name ?? id;
  const hh = stamp ?? '';
  switch (ev.type) {
    case 'agent.state':
      if (ev.state === 'working') return `${hh} ${ev.name ?? nm(ev.agentId)} mengambil ${title(ev.issue) || 'tugas'}`;
      if (ev.state === 'idle') return ev.silent ? null : `${hh} ${ev.name ?? nm(ev.agentId)} kembali ke Lounge`;
      if (ev.state === 'failed') return `${hh} ${ev.name ?? nm(ev.agentId)} gagal${ev.reason ? `: ${ev.reason}` : ''} → Pojok Bug`;
      if (ev.state === 'alert') return `${hh} ${ev.name ?? nm(ev.agentId)} butuh manusia → Pojok Bug`;
      if (ev.state === 'paused') return `${hh} ${ev.name ?? nm(ev.agentId)} dijeda${ev.reason ? ` (${ev.reason})` : ''}`;
      return null;
    case 'handoff':
      return ev.emoji === '❌' ? `${hh} ${nm(ev.from)} mengembalikan ${ev.issue?.identifier ?? ''} ke ${nm(ev.to)} (revisi)` : `${hh} ${nm(ev.from)} menyerahkan ${ev.issue?.identifier ?? 'dokumen'} ke ${nm(ev.to)}`;
    case 'comment': return ev.excerpt ? `${hh} ${ev.fromOwner ? 'Owner → ' : ''}${nm(ev.agentId)} · ${ev.issue?.identifier ?? 'issue'}: ${ev.excerpt}` : `${hh} komentar baru di ${ev.issue?.identifier ?? 'issue'} (${nm(ev.agentId)})`;
    case 'deliver': return `${hh} ${nm(ev.agentId)} meletakkan ${ev.issue?.identifier ?? 'paket'} di Meja Owner, menunggu keputusan`;
    case 'owner.queue': return `${hh} paket menunggu owner: ${ev.count}`;
    case 'owner.decide': return `${hh} owner ${ev.decision === 'rejected' ? 'menolak' : 'menyetujui'} paket`;
    case 'board.add': return `${hh} paket masuk Papan Tayang: ${ev.title ?? ''}`;
    default: return null;
  }
}
