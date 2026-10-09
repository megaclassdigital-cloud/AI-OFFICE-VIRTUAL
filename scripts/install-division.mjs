#!/usr/bin/env node
// install-division.mjs
//
// Memasang definisi division (company + agent + instruksi) dari file di repo ke Paperclip.
// Sumber kebenaran adalah file di divisions/<key>/, bukan state di dalam Paperclip.
//
// IDEMPOTEN: dijalankan dua kali tidak membuat company atau agent ganda (AC1.1 di PRD).
// Pencocokan memakai nama company dan nama agent.
//
// Ditulis di Node, bukan PowerShell, karena Invoke-RestMethod di PowerShell 5.1
// menggantung untuk body JSON yang panjang dan mengandung karakter non-ASCII
// (Content-Length tidak cocok dengan byte UTF-8 yang dikirim). Lihat
// reports/build/2026-10-04_F0.3.md. CLAUDE.md aturan 8 mengizinkan script Node lintas platform.
//
// Pemakaian:
//   node scripts/install-division.mjs
//   node scripts/install-division.mjs --division edukasiai
//   node scripts/install-division.mjs --dry-run
//   node scripts/install-division.mjs --api-base http://127.0.0.1:3177

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Per-agent adapter override. Values named in a.envFromDotenv are read from the repo .env at install
// time and stored only in Paperclip's local config, never written back into the repo.
async function buildAdapterConfig(base, a) {
  const cfg = { ...(base ?? {}), ...(a.adapterConfig ?? {}) };
  if (a.envFromDotenv?.length) {
    const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
    const lines = existsSync(envPath) ? (await readFile(envPath, 'utf8')).split(/\r?\n/) : [];
    cfg.env = { ...(cfg.env ?? {}) };
    for (const entry of a.envFromDotenv) {
      const [k, src = k] = entry.split('=');
      const l = lines.find((x) => x.startsWith(src + '='));
      if (!l) fail(`${src} tidak ada di .env (diperlukan agent '${a.name}')`);
      cfg.env[k] = l.slice(src.length + 1).trim();
    }
  }
  return cfg;
}
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { division: 'edukasiai', apiBase: 'http://127.0.0.1:3177', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--division') out.division = argv[++i];
    else if (a === '--api-base') out.apiBase = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log('node scripts/install-division.mjs [--division <key>] [--api-base <url>] [--dry-run]');
  process.exit(0);
}

const divisionDir = path.join(repoRoot, 'divisions', args.division);
const manifestPath = path.join(divisionDir, 'division.json');

function fail(msg) {
  console.error(`\nGAGAL: ${msg}`);
  process.exit(1);
}

async function api(pathname, { method = 'GET', body } = {}) {
  const url = `${args.apiBase}${pathname}`;
  const init = { method, headers: {} };
  if (body !== undefined) {
    // Buffer.byteLength memastikan Content-Length cocok dengan byte UTF-8 asli.
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    init.headers['content-type'] = 'application/json; charset=utf-8';
    init.headers['content-length'] = String(payload.byteLength);
    init.body = payload;
  }
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${pathname} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

function asList(resp, key) {
  if (Array.isArray(resp)) return resp;
  if (resp && Array.isArray(resp[key])) return resp[key];
  return [];
}

async function main() {
  if (!existsSync(manifestPath)) fail(`Manifest tidak ditemukan: ${manifestPath}`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  console.log(`Division : ${args.division}`);
  console.log(`Manifest : ${manifestPath}`);
  console.log(`API      : ${args.apiBase}`);
  if (args.dryRun) console.log('MODE     : DRY RUN (tidak ada perubahan)');
  console.log('');

  // --- Server hidup? ----------------------------------------------------------
  let health;
  try {
    health = await api('/api/health');
  } catch (e) {
    fail(`Paperclip tidak merespons di ${args.apiBase}. Jalankan scripts/start-paperclip.ps1 lebih dulu.\n${e.message}`);
  }
  if (health.status !== 'ok') {
    fail(`Paperclip belum siap (status=${health.status}). Tunggu sampai 'ok' lalu ulangi.`);
  }

  // --- Company ----------------------------------------------------------------
  const companies = asList(await api('/api/companies'), 'companies');
  let company = companies.find((c) => c.name === manifest.companyName);

  if (company) {
    console.log(`= company '${manifest.companyName}' sudah ada (id=${company.id})`);
  } else if (args.dryRun) {
    console.log(`+ akan MEMBUAT company '${manifest.companyName}'`);
    company = { id: '<dry-run>' };
  } else {
    company = await api('/api/companies', {
      method: 'POST',
      body: {
        name: manifest.companyName,
        description: manifest.description,
        budgetMonthlyCents: manifest.budgetMonthlyCents,
      },
    });
    console.log(`+ company '${manifest.companyName}' DIBUAT (id=${company.id})`);
  }

  const companyId = company.id;

  // --- Agents -----------------------------------------------------------------
  let existingAgents = [];
  if (companyId !== '<dry-run>') {
    existingAgents = asList(await api(`/api/companies/${companyId}/agents`), 'agents');
  }

  // Protokol bersama disisipkan ke instruksi SETIAP agent, supaya aturan anti-loop dan
  // cara memanggil API tidak perlu diduplikasi di lima file (dan tidak bisa lupa dipasang).
  let sharedProtocol = '';
  if (manifest.sharedProtocolFile) {
    const sp = path.join(divisionDir, manifest.sharedProtocolFile);
    if (!existsSync(sp)) fail(`sharedProtocolFile tidak ditemukan: ${sp}`);
    sharedProtocol = '\n\n---\n\n' + (await readFile(sp, 'utf8'));
  }

  let created = 0;
  let updated = 0;

  for (const a of manifest.agents) {
    const instrPath = path.join(divisionDir, a.instructionsFile);
    if (!existsSync(instrPath)) {
      fail(`File instruksi tidak ditemukan untuk agent '${a.name}': ${instrPath}`);
    }
    const instructions = (await readFile(instrPath, 'utf8')) + sharedProtocol;

    const payload = {
      name: a.name,
      role: a.role,
      title: a.title,
      icon: a.icon,
      capabilities: a.capabilities,
      adapterType: a.adapterType ?? manifest.defaultAdapterType,
      // Least privilege: agent coding CLI punya akses shell, jadi working directory
      // dibatasi ke workspace/ dan tidak dibiarkan di root repo (PRD bagian 8).
      ...(manifest.defaultAdapterConfig || a.adapterConfig
        ? { adapterConfig: await buildAdapterConfig(manifest.defaultAdapterConfig, a) }
        : {}),
      instructionsBundle: {
        entryFile: 'AGENTS.md',
        files: { 'AGENTS.md': instructions },
      },
    };

    const existing = existingAgents.find((x) => x.name === a.name);
    // Adapter dikelola skrip lain (mis. manager-failover): jangan menimpanya saat memperbarui agent yang sudah ada.
    if (existing && a.adapterManagedBy) { delete payload.adapterType; delete payload.adapterConfig; }

    if (existing) {
      if (args.dryRun) {
        console.log(`~ akan MEMPERBARUI agent '${a.name}' (id=${existing.id})`);
        continue;
      }
      await api(`/api/agents/${existing.id}`, { method: 'PATCH', body: payload });
      // PATCH /api/agents/{id} TIDAK memperbarui instructionsBundle (terbukti: isi instruksi
      // tetap versi lama setelah PATCH). File instruksi harus ditulis lewat endpoint khusus,
      // kalau tidak repo dan Paperclip diam-diam jadi tidak sinkron.
      await api(`/api/agents/${existing.id}/instructions-bundle/file`, {
        method: 'PUT',
        body: { path: 'AGENTS.md', content: instructions },
      });
      console.log(`~ agent '${a.name}' DIPERBARUI (id=${existing.id})`);
      updated++;
    } else {
      if (args.dryRun) {
        console.log(`+ akan MEMBUAT agent '${a.name}' (role=${a.role})`);
        created++;
        continue;
      }
      const made = await api(`/api/companies/${companyId}/agents`, { method: 'POST', body: payload });
      console.log(`+ agent '${a.name}' DIBUAT (id=${made.id})`);
      created++;
    }
  }

  // Reporting lines (org chart): agents with reportsToKey report to that agent. Dry run never writes.
  if (!args.dryRun) {
    const nowAgents = await api(`/api/companies/${companyId}/agents`);
    const byName = (n) => nowAgents.find((x) => x.name === n);
    const keyToName = new Map(manifest.agents.map((x) => [x.key, x.name]));
    for (const a of manifest.agents.filter((x) => x.reportsToKey)) {
      const boss = byName(keyToName.get(a.reportsToKey));
      const me = byName(a.name);
      if (boss && me && me.reportsTo !== boss.id) {
        await api(`/api/agents/${me.id}`, { method: 'PATCH', body: { reportsTo: boss.id } });
        console.log(`~ '${a.name}' melapor ke '${boss.name}'`);
      }
    }
  }

  console.log('');
  console.log(`Ringkasan: dibuat=${created} diperbarui=${updated}`);

  if (args.dryRun) {
    console.log('\nDry run selesai.');
    return;
  }

  // --- Verifikasi -------------------------------------------------------------
  const after = asList(await api(`/api/companies/${companyId}/agents`), 'agents');
  const expected = manifest.agents.length;
  console.log(`\nAgent di company '${manifest.companyName}': ${after.length} (diharapkan ${expected})`);
  for (const x of after) console.log(`  - ${x.name} [role=${x.role}] adapter=${x.adapterType} id=${x.id}`);

  if (after.length !== expected) {
    console.error(
      `\nPERINGATAN: jumlah agent (${after.length}) tidak sama dengan manifest (${expected}). ` +
        'Periksa agent yang dibuat di luar script ini.'
    );
    process.exit(1);
  }

  console.log('\nSelesai.');
}

main().catch((e) => fail(e.stack || e.message));
