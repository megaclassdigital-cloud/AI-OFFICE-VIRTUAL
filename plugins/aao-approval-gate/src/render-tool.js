// Tool render_carousel (F1.8a): menjalankan renderer deterministik (scripts/render.mjs) sebagai proses terpisah.
//
// Renderer tetap satu-satunya yang membuat PNG; tool ini hanya memanggilnya dengan masukan yang sudah dibatasi.
// Pembatasan: design spec harus berada di dalam <repo>/workspace, keluaran selalu ke
// <repo>/workspace/issues/<issueId>/render, nama division hanya [a-z0-9-]. Tidak ada shell.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIVISION_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

export class RenderInputError extends Error {}

export function defaultRepoRoot() {
  return process.env.AAO_REPO_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/** true bila `child` berada di dalam `parent` (bukan sama, bukan di luar, tahan `..`). */
export function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function resolveRenderInputs({ repoRoot = defaultRepoRoot(), designPath, issueId, division = 'edukasiai' }) {
  if (!UUID_RE.test(String(issueId ?? ''))) throw new RenderInputError('issueId harus UUID');
  if (!DIVISION_RE.test(String(division))) throw new RenderInputError('nama division tidak valid');
  if (typeof designPath !== 'string' || !designPath.trim()) throw new RenderInputError('designPath wajib');
  const workspace = path.join(repoRoot, 'workspace');
  const design = path.isAbsolute(designPath) ? path.resolve(designPath) : path.resolve(workspace, designPath);
  if (!isInside(workspace, design)) throw new RenderInputError('designPath harus berada di dalam folder workspace');
  if (!existsSync(design)) throw new RenderInputError('berkas design spec tidak ditemukan');
  const outDir = path.join(workspace, 'issues', String(issueId), 'render');
  return { repoRoot, design, outDir, division };
}

/**
 * @returns {{exitCode:number, passed:boolean, pngCount:number, outDir:string, hashes?:object, visualQa?:object, stderr:string}}
 */
export async function runRender(input, { timeoutMs = 120_000, spawnImpl = spawn, nodePath = process.execPath } = {}) {
  const { repoRoot, design, outDir, division } = resolveRenderInputs(input);
  const script = path.join(repoRoot, 'scripts', 'render.mjs');
  const args = [script, '--design', design, '--out', outDir, '--division', division];
  const { exitCode, stderr } = await new Promise((resolve, reject) => {
    const child = spawnImpl(nodePath, args, { cwd: repoRoot, shell: false, windowsHide: true });
    let err = '';
    child.stderr?.on('data', (d) => { if (err.length < 8000) err += d; });
    child.stdout?.on('data', () => {});
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`render melebihi ${timeoutMs} ms`)); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ exitCode: code ?? -1, stderr: err.trim() }); });
  });

  const out = { exitCode, passed: false, pngCount: 0, outDir, stderr: stderr.slice(0, 2000) };
  try {
    out.visualQa = JSON.parse(await readFile(path.join(outDir, 'visual-qa.json'), 'utf8'));
    out.hashes = JSON.parse(await readFile(path.join(outDir, 'hashes.json'), 'utf8'));
    out.pngCount = out.visualQa.pngCount;
    out.passed = exitCode === 0 && out.visualQa.passed === true;
  } catch { /* render ditolak sebelum menulis laporan (exit 2): stderr menjelaskan alasannya */ }
  return out;
}
