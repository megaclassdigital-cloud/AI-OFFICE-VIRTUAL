#!/usr/bin/env node
// secret-scan.mjs — pemindai secret sederhana untuk repo (H3.2): berkas yang dilacak git DAN seluruh riwayat (git log --all -p).
// Tidak mengirim apa pun ke luar. Temuan dicetak dengan nilai DISAMARKAN. Keluar 1 bila ada temuan yang tidak di-allowlist.
//
// Pemakaian: node scripts/secret-scan.mjs [--no-history] [--json]
// Allowlist: scripts/secret-scan.allow.json  [{ "pattern": "<nama aturan>", "contains": "<potongan baris>", "reason": "..." }]

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const RULES = [
  { name: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'openai-style-key', re: /\bsk-(?:proj-|live-|ant-)?[A-Za-z0-9_-]{24,}\b/ },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'owner-token-literal', re: /AAO_OWNER_TOKEN\s*=\s*[0-9a-f]{32,}/ },
  { name: 'bearer-token-literal', re: /[Aa]uthorization['"]?\s*[:=]\s*['"]?Bearer\s+[A-Za-z0-9._~+/-]{24,}/ },
  { name: 'secret-assignment', re: /\b(?:api[_-]?key|secret|password|passwd|token)\b['"]?\s*[:=]\s*['"][A-Za-z0-9_\-/+=]{20,}['"]/i },
];

export function maskValue(s) {
  const t = String(s).trim();
  return t.length <= 8 ? '***' : `${t.slice(0, 4)}…${t.slice(-2)} (${t.length} karakter)`;
}

/** @returns {{rule:string, line:number, where:string, sample:string}[]} */
export function scanText(text, where, allow = []) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const r of RULES) {
      const m = r.re.exec(line);
      if (!m) continue;
      if (allow.some((a) => a.pattern === r.name && line.includes(a.contains))) continue;
      out.push({ rule: r.name, line: i + 1, where, sample: maskValue(m[0]) });
    }
  });
  return out;
}

const git = (args, max = 256 * 1024 * 1024) => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: max });

export function scanRepo({ history = true, allow = [] } = {}) {
  const findings = [];
  const files = git(['ls-files', '-z']).stdout.split('\0').filter(Boolean);
  for (const f of files) {
    if (/\.(png|jpg|jpeg|gif|webp|woff2?|ttf|ico|webm|mp4|zip)$/i.test(f)) continue;
    let text;
    try { text = readFileSync(path.join(repoRoot, f), 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue;
    findings.push(...scanText(text, `berkas:${f}`, allow));
  }
  let commits = 0;
  if (history) {
    const log = git(['log', '--all', '-p', '--no-color', '--format=@@COMMIT %H', '--text']).stdout;
    let cur = '?';
    log.split('\n').forEach((line, i) => {
      if (line.startsWith('@@COMMIT ')) { cur = line.slice(9, 16); commits += 1; return; }
      if (!line.startsWith('+') || line.startsWith('+++')) return;
      for (const f of scanText(line.slice(1), `riwayat:${cur}`, allow)) findings.push({ ...f, line: i + 1 });
    });
  }
  return { files: files.length, commits, findings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const allowFile = path.join(repoRoot, 'scripts', 'secret-scan.allow.json');
  const allow = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')) : [];
  const r = scanRepo({ history: !a.includes('--no-history'), allow });
  if (a.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`Dipindai: ${r.files} berkas terlacak, ${r.commits} commit. Temuan: ${r.findings.length}`);
    for (const f of r.findings) console.log(`  [${f.rule}] ${f.where} baris ${f.line}: ${f.sample}`);
  }
  process.exit(r.findings.length ? 1 : 0);
}
