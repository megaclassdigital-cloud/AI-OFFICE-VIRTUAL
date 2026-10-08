// Helper bersama untuk test repo AI Agent Office.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { urlKey, designHash, verifyScope, renderScope } from '../plugins/aao-approval-gate/src/provenance.js';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Folder sementara unik per pemanggilan. */
export function makeTmp(prefix = 'aao-test-') {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** Tulis objek sebagai JSON UTF-8 tanpa BOM, kembalikan path-nya. */
export function writeJson(dir, name, obj) {
  const p = path.join(dir, name);
  writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
  return p;
}

/**
 * Jalankan `node <script> ...args` secara ASINKRON (event loop test tetap hidup, jadi server HTTP
 * tiruan di proses test masih bisa menjawab). Mengembalikan { code, stdout, stderr }.
 */
export function runNode(args, { cwd = repoRoot, env = {}, timeoutMs = 90_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout ${timeoutMs}ms: node ${args.join(' ')}`));
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Jumlah berkas .png di sebuah folder (0 bila folder belum ada). */
export function countPng(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).length;
}

/**
 * Segel render + catatan verify_candidate untuk ctx palsu (meniru apa yang ditulis render_carousel dan verify_candidate).
 * Mengembalikan pasangan [scope, nilai] siap dimasukkan ke state palsu.
 */
export function provenanceEntries(issueId, docs, renderDir) {
  const readJ = (f) => JSON.parse(readFileSync(path.join(renderDir, f), 'utf8').replace(/^﻿/, ''));
  const log = {};
  for (const r of (docs['verification-result']?.results ?? []).filter((x) => x.status === 'verified')) {
    log[urlKey(r.url)] = { url: r.url, publishedAt: r.checks.dateWithinWindow.publishedAt, urlOk: r.checks.urlReachable.ok, dateOk: r.checks.dateWithinWindow.ok, httpStatus: 200, at: new Date().toISOString() };
  }
  return [
    [verifyScope(issueId), log],
    [renderScope(issueId), { designHash: docs['carousel-design'] ? designHash(docs['carousel-design']) : 'tidak-ada', visualQa: readJ('visual-qa.json'), hashes: readJ('hashes.json'), at: new Date().toISOString() }],
  ];
}
