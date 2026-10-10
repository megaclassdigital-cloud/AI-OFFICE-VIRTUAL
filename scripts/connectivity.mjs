// connectivity.mjs — evaluator konektivitas yang MURNI: dari hasil probe menjadi status per komponen, masalah, dan keputusan pemulihan.
// Dipakai office-launcher (pengawas) dan dites tanpa jaringan.
import { isFresh } from './heartbeat.mjs';

export const HEARTBEAT_MAX_AGE_MS = { orchestrator: 75_000, failover: 150_000 };
export const COMPONENT_LABEL = { paperclip: 'Paperclip', plugin: 'Plugin approval-gate', agents: 'Agent EdukasiAI', 'office-view': 'Office View', orchestrator: 'Orkestrator', failover: 'Failover model' };

/**
 * @param {object} p
 * @param {number} p.nowMs
 * @param {{reachable:boolean, status?:string, version?:string}} p.paperclip
 * @param {{ready:boolean|null}} p.plugin             null = belum bisa diperiksa
 * @param {{count:number|null, expected?:number}} p.agents
 * @param {{reachable:boolean, connected:boolean|null}} p.officeView   connected = jembatan Office View ke Paperclip
 * @param {object|null} p.orchestrator  detak jantung
 * @param {object|null} p.failover      detak jantung
 * @param {{orchestrator?:boolean, failover?:boolean}} [p.alive]   proses hidup menurut pengawas
 * @returns {{overall:'ok'|'sebagian'|'putus', components:{key:string,label:string,state:'ok'|'mulai'|'tidak-terhubung'|'mati',detail:string}[], problems:string[]}}
 */
export function evaluateHealth({ nowMs, paperclip, plugin, agents, officeView, orchestrator, failover, alive = {} }) {
  const c = [];
  const add = (key, state, detail) => c.push({ key, label: COMPONENT_LABEL[key], state, detail });
  const pcOk = paperclip?.reachable === true && paperclip.status === 'ok';

  if (!paperclip?.reachable) add('paperclip', 'mati', 'tidak terjangkau di 127.0.0.1:3177');
  else if (paperclip.status !== 'ok') add('paperclip', 'mulai', `status ${paperclip.status ?? 'tidak diketahui'} (pemulihan awal, tunggu)`);
  else add('paperclip', 'ok', `versi ${paperclip.version ?? '?'}`);

  if (!pcOk) add('plugin', 'tidak-terhubung', 'menunggu Paperclip');
  else if (plugin?.ready === false) add('plugin', 'tidak-terhubung', 'plugin approval-gate belum siap (tool tidak terdaftar)');
  else add('plugin', 'ok', plugin?.ready === null ? 'tidak diperiksa' : 'tool terdaftar');

  const expected = agents?.expected ?? 6;
  if (!pcOk) add('agents', 'tidak-terhubung', 'menunggu Paperclip');
  else if (agents?.count == null) add('agents', 'tidak-terhubung', 'daftar agent tidak terbaca');
  else if (agents.count < expected) add('agents', 'tidak-terhubung', `${agents.count} dari ${expected} agent terdaftar`);
  else add('agents', 'ok', `${agents.count} agent`);

  if (!officeView?.reachable) add('office-view', 'mati', 'server UI tidak menjawab');
  else if (officeView.connected === false) add('office-view', 'tidak-terhubung', 'UI hidup tetapi jembatan ke Paperclip putus');
  else add('office-view', 'ok', 'UI dan jembatan ke Paperclip terhubung');

  for (const key of ['orchestrator', 'failover']) {
    const hb = key === 'orchestrator' ? orchestrator : failover;
    // 'sibuk sampai' = komponen sedang menjalankan panggilan sinkron yang lama (render/ambil aset/finalisasi) dan sengaja tidak berdetak; bukan macet.
    const fresh = isFresh(hb, HEARTBEAT_MAX_AGE_MS[key], nowMs) || (Number.isFinite(hb?.busyUntil) && hb.busyUntil > nowMs);
    if (!fresh && alive[key] === false) add(key, 'mati', 'proses tidak berjalan');
    else if (!fresh) add(key, hb ? 'tidak-terhubung' : 'mulai', hb ? `tidak ada detak ${Math.round((nowMs - hb.at) / 1000)} dtk (macet)` : 'belum ada detak (baru dinyalakan)');
    else if (hb.paperclipOk === false) add(key, 'tidak-terhubung', 'hidup tetapi tidak bisa menghubungi Paperclip');
    else add(key, 'ok', 'berdetak dan terhubung');
  }

  const bad = c.filter((x) => x.state !== 'ok');
  const problems = bad.map((x) => `${x.label}: ${x.detail}`);
  const overall = !bad.length ? 'ok' : c[0].state === 'mati' ? 'putus' : 'sebagian';
  return { overall, components: c, problems };
}

/** Jeda tunggu sebelum dimulai ulang: eksponensial dari 2 detik, maksimal 60 detik. */
export const backoffMs = (restarts) => Math.min(60_000, 2_000 * 2 ** Math.max(0, restarts));
/** Lingkaran macet: terlalu banyak mulai-ulang dalam jendela waktu => berhenti memaksa dan lapor owner. */
export const crashLoop = (restartTimes, nowMs, max = 6, windowMs = 5 * 60_000) => restartTimes.filter((t) => nowMs - t <= windowMs).length >= max;

/**
 * Perlu dimulai ulang? Mati = ya. Tidak-terhubung hanya bila Paperclip sendiri sehat dan keadaan itu berlangsung melebihi masa tenggang
 * (komponen diberi waktu menyambung ulang sendiri dulu). Mulai = tunggu. Ok = tidak.
 */
export function shouldRestart({ state, sinceMs, nowMs, paperclipOk, graceMs = 60_000 }) {
  if (state === 'mati') return { restart: true, why: 'proses mati' };
  if (state === 'tidak-terhubung' && paperclipOk && sinceMs != null && nowMs - sinceMs > graceMs) return { restart: true, why: `tidak terhubung > ${Math.round(graceMs / 1000)} dtk padahal Paperclip sehat` };
  return { restart: false, why: '' };
}

/** Ringkasan satu baris untuk tray/tooltip. */
export function summaryLine({ overall, components, paused }) {
  const bad = components.filter((x) => x.state !== 'ok').map((x) => x.label);
  const head = overall === 'ok' ? 'Semua terhubung' : overall === 'putus' ? 'Paperclip PUTUS' : `Sebagian bermasalah: ${bad.join(', ')}`;
  return paused ? `${head} · DIJEDA` : head;
}
