#!/usr/bin/env node
// Office View server: read-only by default (opt-in --enable-talk adds one owner->Manager message path), bind 127.0.0.1:3190. Tidak ada aksi tulis ke Paperclip dan tidak ada panggilan LLM.
//
// Pemakaian: node apps/office-view/server.mjs [--port 3190] [--paperclip http://127.0.0.1:3177] [--open] [--poll-ms 2000]

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridge } from './bridge.mjs';
import { createTalk } from './talk.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const pub = path.join(here, 'public');
const a = process.argv.slice(2);
const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);

export const PORT = Number(arg('--port', process.env.AAO_OFFICE_PORT ?? 3190));
const PAPERCLIP = arg('--paperclip', process.env.AAO_API_BASE ?? 'http://127.0.0.1:3177');
const POLL_MS = Number(arg('--poll-ms', 1500));
const LAYOUT_FILE = path.join(repoRoot, 'divisions', 'edukasiai', 'office', 'layout.json');
const REPLAY_FILE = path.join(repoRoot, 'fixtures', 'office-events', 'demo-carousel.jsonl');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };

const TALK = a.includes('--enable-talk');
const talk = TALK ? createTalk({ base: PAPERCLIP, port: PORT, outputRoot: path.join(repoRoot, 'workspace', 'agent'), inboxRoot: path.join(repoRoot, 'workspace', 'inbox'), stateFile: path.join(repoRoot, 'workspace', 'orchestrator-state.json'), orchLogFile: path.join(repoRoot, 'reports', 'orchestrator.log'), netFile: path.join(repoRoot, 'workspace', 'network-state.json') }) : null;

export const bridge = createBridge({ base: PAPERCLIP, log: (m) => console.error(m) });

const json = (res, code, body) => { res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const strip = (s) => s.replace(/^﻿/, '');

export async function readReplay() {
  const text = strip(await readFile(REPLAY_FILE, 'utf8'));
  return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
}

export const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (talk && (await talk(req, res, u, json))) return;
    if (u.pathname === '/api/talk/info') return json(res, 200, { enabled: false });
    if (req.method !== 'GET') return json(res, 405, { error: 'Office View read-only' });
    const p = u.pathname;
    if (p === '/api/layout') return json(res, 200, JSON.parse(strip(await readFile(LAYOUT_FILE, 'utf8'))));
    if (p === '/api/network') {
      // Status internet dari sentinel orkestrator (read-only). Berkas basi = tidak dianggap offline.
      let st = null; try { st = JSON.parse(strip(await readFile(path.join(repoRoot, 'workspace', 'network-state.json'), 'utf8'))); } catch { /* belum ada */ }
      const fresh = st && Date.now() - (st.updatedAtMs ?? 0) < 120_000;
      return json(res, 200, { offline: !!(fresh && st.hold === true), announced: !!(fresh && st.announcedOffline), since: fresh ? st.since : null, known: !!fresh });
    }
    if (p === '/api/status') return json(res, 200, bridge.status());
    if (p === '/api/snapshot') return json(res, 200, bridge.snapshot());
    if (p === '/api/events') return json(res, 200, bridge.eventsSince(Number(u.searchParams.get('since') ?? 0) || 0));
    if (p === '/api/replay') return json(res, 200, { events: await readReplay() });
    if (p.startsWith('/api/')) return json(res, 404, { error: 'rute tidak ada' });
    const rel = p === '/' ? '/index.html' : decodeURIComponent(p);
    const file = path.join(pub, rel);
    if (!file.startsWith(pub + path.sep)) return json(res, 403, { error: 'dilarang' });
    const buf = await readFile(file).catch(() => null);
    if (!buf) return json(res, 404, { error: 'tidak ada' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  } catch (e) {
    json(res, 500, { error: String(e?.message ?? e) });
  }
});

let timer;
export function startPolling(ms = POLL_MS) {
  const tick = async () => { await bridge.poll(); timer = setTimeout(tick, ms); };
  tick();
}
export const stopPolling = () => clearTimeout(timer);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${PORT}`;
    console.log(`Office View: ${url}  (read-only; Paperclip ${PAPERCLIP}; polling ${POLL_MS} ms)`);
    startPolling();
    if (a.includes('--open')) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  });
}
