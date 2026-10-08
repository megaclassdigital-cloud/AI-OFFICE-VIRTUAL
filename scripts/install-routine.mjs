#!/usr/bin/env node
// install-routine.mjs — memasang routine harian EdukasiAI di Paperclip (F2.4). NONAKTIF secara default.
//
// Routine: Senin-Jumat 07.00 WIB, ditugaskan ke Researcher (awal alur), project "Carousel Berita AI".
// Anti duplikat:
//   - concurrencyPolicy `skip_if_active`: pemicu saat run/issue routine sebelumnya masih aktif dilewati, tidak diantre;
//   - catchUpPolicy `skip_missed`: pemicu yang terlewat (mesin mati) tidak diulang beramai-ramai;
//   - installer idempoten: dipanggil berulang tetap satu routine (dicari berdasarkan judul).
// Default: routine `paused` DAN trigger `enabled:false`. Owner mengaktifkan saat burn-in dengan `--enable`.
// Skrip ini TIDAK PERNAH menjalankan routine (tidak memanggil /run), jadi tidak ada run agent dari sini.
//
// Pemakaian:
//   node scripts/install-routine.mjs            # pasang (nonaktif) atau tampilkan yang ada
//   node scripts/install-routine.mjs --enable   # aktifkan (owner)
//   node scripts/install-routine.mjs --disable  # nonaktifkan lagi

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROUTINE_TITLE = 'EdukasiAI — carousel berita AI harian';
export const CRON = '0 7 * * 1-5';
export const TIMEZONE = 'Asia/Jakarta';

export function buildRoutineSpec({ assigneeAgentId, projectId }) {
  return {
    routine: {
      title: ROUTINE_TITLE,
      description: [
        'Cari kandidat berita AI 7 hari terakhir, verifikasi, tulis carousel, desain, QA, lalu serahkan ke owner.',
        'Berhenti di in_review: approve/reject hanya oleh owner, tidak ada posting otomatis.',
        'Patuhi batas run dan token di divisions/edukasiai/limits.json; bila batas tercapai, berhenti dan laporkan.',
      ].join('\n'),
      assigneeAgentId, projectId,
      priority: 'medium',
      status: 'paused',
      concurrencyPolicy: 'skip_if_active',
      catchUpPolicy: 'skip_missed',
    },
    trigger: { kind: 'schedule', label: 'Senin-Jumat 07.00 WIB', enabled: false, cronExpression: CRON, timezone: TIMEZONE },
  };
}

/** Klien HTTP kecil; Node fetch + Buffer (aman untuk teks Indonesia, lihat CLAUDE.md fakta 5). */
export function httpClient(apiBase) {
  const j = async (p, o = {}) => {
    const body = o.body === undefined ? undefined : Buffer.from(JSON.stringify(o.body), 'utf8');
    const r = await fetch(apiBase + p, { method: o.method ?? 'GET', headers: body ? { 'content-type': 'application/json', 'content-length': String(body.length) } : {}, body });
    const t = await r.text();
    if (!r.ok) throw new Error(`Paperclip HTTP ${r.status} ${p}: ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : null;
  };
  return {
    companies: () => j('/companies'),
    agents: (co) => j(`/companies/${co}/agents`),
    projects: (co) => j(`/companies/${co}/projects`),
    routines: (co) => j(`/companies/${co}/routines`),
    getRoutine: (id) => j(`/routines/${id}`),
    createRoutine: (co, body) => j(`/companies/${co}/routines`, { method: 'POST', body }),
    patchRoutine: (id, body) => j(`/routines/${id}`, { method: 'PATCH', body }),
    createTrigger: (id, body) => j(`/routines/${id}/triggers`, { method: 'POST', body }),
    patchTrigger: (id, body) => j(`/routine-triggers/${id}`, { method: 'PATCH', body }),
  };
}

/** @param {{enable?:boolean, disable?:boolean}} mode  tanpa keduanya: pasang nonaktif, jangan ubah yang sudah ada */
export async function installRoutine(client, { companyId, assigneeAgentId, projectId }, mode = {}) {
  const spec = buildRoutineSpec({ assigneeAgentId, projectId });
  const existing = (await client.routines(companyId)).filter((r) => r.title === ROUTINE_TITLE && r.status !== 'archived');
  if (existing.length > 1) throw new Error(`ada ${existing.length} routine berjudul sama; rapikan manual (owner) sebelum melanjutkan`);
  let routine = existing[0];
  let created = false;
  if (!routine) { routine = await client.createRoutine(companyId, spec.routine); created = true; }

  const detail = await client.getRoutine(routine.id);
  const triggers = (detail.triggers ?? []).filter((t) => t.kind === 'schedule');
  if (triggers.length > 1) throw new Error('routine punya lebih dari satu trigger jadwal; rapikan manual (owner)');
  let trigger = triggers[0];
  if (!trigger) trigger = await client.createTrigger(routine.id, spec.trigger);
  const trig = trigger.trigger ?? trigger;

  if (mode.enable && mode.disable) throw new Error('--enable dan --disable tidak boleh bersamaan');
  if (mode.enable) {
    await client.patchTrigger(trig.id, { enabled: true });
    await client.patchRoutine(routine.id, { status: 'active' });
  } else if (mode.disable) {
    await client.patchRoutine(routine.id, { status: 'paused' });
    await client.patchTrigger(trig.id, { enabled: false });
  }
  const final = await client.getRoutine(routine.id);
  return { created, routineId: routine.id, status: final.status, trigger: (final.triggers ?? []).map((t) => ({ kind: t.kind, enabled: t.enabled, cron: t.cronExpression, timezone: t.timezone })) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const c = httpClient(arg('--api', 'http://127.0.0.1:3177/api'));
  try {
    const co = (await c.companies()).find((x) => /edukasi/i.test(x.name) && !/mega\s*class/i.test(x.name));
    if (!co) throw new Error('company EdukasiAI tidak ditemukan');
    const researcher = (await c.agents(co.id)).find((x) => x.name === 'Researcher');
    const project = (await c.projects(co.id)).find((x) => /carousel berita ai/i.test(x.name));
    if (!researcher || !project) throw new Error('agent Researcher atau project "Carousel Berita AI" tidak ditemukan');
    console.log(JSON.stringify(await installRoutine(c, { companyId: co.id, assigneeAgentId: researcher.id, projectId: project.id }, { enable: a.includes('--enable'), disable: a.includes('--disable') }), null, 2));
  } catch (e) { console.error(`GAGAL: ${e.message}`); process.exit(2); }
}
