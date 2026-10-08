#!/usr/bin/env node
// sync-plugin-manifest.mjs — menyalin TOOL_DEFS (plugins/aao-approval-gate/src/agent-tools.js) ke daftar `tools`
// di manifest.js. Manifest sengaja statis: server meng-cache modul yang di-import manifest, sehingga daftar tool
// bisa basi setelah reinstall. Test (tests/agent-tools.test.mjs) menjaga keduanya identik.
//
// Pemakaian: node scripts/sync-plugin-manifest.mjs [--bump x.y.z]

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'plugins', 'aao-approval-gate');
const manifestFile = path.join(dir, 'manifest.js');
const pkgFile = path.join(dir, 'package.json');

const bump = process.argv.includes('--bump') ? process.argv[process.argv.indexOf('--bump') + 1] : null;
const { TOOL_DEFS } = await import(pathToFileURL(path.join(dir, 'src', 'agent-tools.js')).href);
const current = (await import(`${pathToFileURL(manifestFile).href}?t=${Date.now()}`)).default;
const hello = current.tools.find((t) => t.name === 'aao_hello');
const tools = [hello, ...Object.entries(TOOL_DEFS).map(([name, d]) => ({ name, ...d }))];

let src = readFileSync(manifestFile, 'utf8');
const marker = '  // Statis dengan sengaja';
const at = src.indexOf(marker);
if (at < 0) throw new Error('penanda "Statis dengan sengaja" tidak ditemukan di manifest.js');
// JSON valid adalah JS valid; kunci tidak perlu tanda kutip, isi string dibiarkan persis (tanpa mengubah kutip di dalamnya).
const body = JSON.stringify(tools, null, 2).replace(/\n/g, '\n  ').replace(/^(\s*)"([A-Za-z_][A-Za-z0-9_]*)":/gm, '$1$2:');
src = `${src.slice(0, at)}${marker}: server meng-cache modul yang di-import manifest, sehingga daftar tool bisa basi.\n  // Dihasilkan oleh scripts/sync-plugin-manifest.mjs; test menjaga daftar ini identik dengan TOOL_DEFS.\n  tools: ${body},\n};\n`;
if (bump) {
  src = src.replace(/version: '[^']+'/, `version: '${bump}'`);
  writeFileSync(pkgFile, readFileSync(pkgFile, 'utf8').replace(/"version":\s*"[^"]+"/, `"version": "${bump}"`), 'utf8');
}
writeFileSync(manifestFile, src, 'utf8');
console.log(`manifest.js disinkronkan: ${tools.length} tool${bump ? `, versi ${bump}` : ''}`);
