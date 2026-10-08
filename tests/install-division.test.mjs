// Test scripts/install-division.mjs --dry-run terhadap server HTTP tiruan.
//
// Tidak memerlukan Paperclip hidup: server tiruan di proses test meniru endpoint yang dipakai installer
// dan MENCATAT semua request. Yang dibuktikan:
//   1. --dry-run tidak pernah mengirim POST/PATCH/PUT/DELETE (tidak mengubah apa pun).
//   2. Rencana yang dicetak benar: company dikenali, lima agent akan dibuat.
//   3. Server mati atau belum siap -> gagal jelas, bukan menggantung.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { runNode, repoRoot } from './helpers.mjs';

const installer = path.join(repoRoot, 'scripts', 'install-division.mjs');

/** Server tiruan. `state` mengatur isi jawaban; `log` mencatat semua request. */
function startFakePaperclip(state) {
  const log = [];
  const server = http.createServer((req, res) => {
    log.push({ method: req.method, url: req.url });
    const send = (code, body) => {
      const text = JSON.stringify(body);
      res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
      res.end(text);
    };
    if (req.method === 'GET' && req.url === '/api/health') return send(200, { status: state.health ?? 'ok' });
    if (req.method === 'GET' && req.url === '/api/companies') return send(200, state.companies ?? []);
    const m = req.url.match(/^\/api\/companies\/([^/]+)\/agents$/);
    if (req.method === 'GET' && m) return send(200, state.agents ?? []);
    return send(404, { error: 'tidak dikenal oleh server tiruan', url: req.url });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, log, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

describe('install-division.mjs --dry-run', () => {
  let fake;
  const state = {};

  beforeEach(async () => {
    Object.keys(state).forEach((k) => delete state[k]);
    fake = await startFakePaperclip(state);
  });
  afterEach(() => new Promise((r) => fake.server.close(r)));

  it('company ada, belum ada agent: merencanakan 5 agent dan TIDAK mengubah apa pun', async () => {
    state.companies = [{ id: 'c-edu', name: 'EdukasiAI' }];
    state.agents = [];
    const r = await runNode([installer, '--dry-run', '--api-base', fake.base]);

    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/DRY RUN/);
    expect(r.stdout).toMatch(/company 'EdukasiAI' sudah ada \(id=c-edu\)/);
    for (const name of ['Researcher', 'Verifier', 'Copywriter', 'Designer', 'QA']) {
      expect(r.stdout).toContain(`akan MEMBUAT agent '${name}'`);
    }
    expect(r.stdout).toMatch(/dibuat=5/);

    const mutating = fake.log.filter((q) => q.method !== 'GET');
    expect(mutating).toEqual([]);
  });

  it('company belum ada: merencanakan membuat company, tetap tanpa mengubah apa pun', async () => {
    state.companies = [];
    const r = await runNode([installer, '--dry-run', '--api-base', fake.base]);

    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/akan MEMBUAT company 'EdukasiAI'/);
    expect(r.stdout).toMatch(/dibuat=5/);
    expect(fake.log.filter((q) => q.method !== 'GET')).toEqual([]);
  });

  it('agent sudah ada: merencanakan MEMPERBARUI (idempoten), bukan membuat ganda', async () => {
    state.companies = [{ id: 'c-edu', name: 'EdukasiAI' }];
    state.agents = ['Researcher', 'Verifier', 'Copywriter', 'Designer', 'QA'].map((name, i) => ({ id: `a${i}`, name }));
    const r = await runNode([installer, '--dry-run', '--api-base', fake.base]);

    expect(r.code).toBe(0);
    expect(r.stdout).not.toMatch(/akan MEMBUAT agent/);
    expect(r.stdout).toMatch(/akan MEMPERBARUI agent 'Researcher'/);
    expect(r.stdout).toMatch(/dibuat=0/);
    expect(fake.log.filter((q) => q.method !== 'GET')).toEqual([]);
  });

  it('server belum siap (status bukan ok): gagal jelas dengan exit 1', async () => {
    state.health = 'starting';
    const r = await runNode([installer, '--dry-run', '--api-base', fake.base]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/belum siap \(status=starting\)/);
    // tidak boleh sampai membaca company sebelum yakin server siap
    expect(fake.log.map((q) => q.url)).toEqual(['/api/health']);
  });

  it('server mati: gagal jelas dengan petunjuk start-paperclip, tidak menggantung', async () => {
    await new Promise((r) => fake.server.close(r));
    const r = await runNode([installer, '--dry-run', '--api-base', fake.base]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/Paperclip tidak merespons/);
    expect(r.stderr).toMatch(/start-paperclip/);
    // afterEach akan menutup server yang sudah tertutup; buat server dummy agar tidak error
    fake = await startFakePaperclip(state);
  });

  it('manifest division yang tidak ada: gagal dengan pesan jelas', async () => {
    const r = await runNode([installer, '--dry-run', '--division', 'tidak-ada', '--api-base', fake.base]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/Manifest tidak ditemukan/);
  });
});
