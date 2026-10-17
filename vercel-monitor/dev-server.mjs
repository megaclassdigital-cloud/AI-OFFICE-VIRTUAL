#!/usr/bin/env node
// dev-server.mjs — peniru lokal Vercel untuk latihan (tanpa akun Vercel): menjalankan fungsi api/*.js yang SAMA, rewrite yang sama, dan pemeriksaan
// cookie seperti middleware, dengan penyimpanan folder lokal. Pemakaian: MIRROR_FS_DIR=... MIRROR_INGEST_SECRET=... MIRROR_REVIEW_KEY=... MIRROR_SESSION_SECRET=... node vercel-monitor/dev-server.mjs [--port 3199]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ingest from './api/ingest.js';
import review from './api/review.js';
import data from './api/data.js';
import { parseSession, send } from './api/_lib.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

export function createDevServer() {
  return http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/review' || p === '/api/review') return review(req, res);
    if (p === '/api/ingest') return ingest(req, res);
    // middleware: semua selain di atas butuh cookie sesi
    if (!parseSession(req.headers.cookie, process.env.MIRROR_SESSION_SECRET)) return send(res, 401, 'Akses ditolak. Buka tautan monitor yang diberikan.', 'text/plain; charset=utf-8');
    if (p.startsWith('/api/')) {
      const r = p.slice('/api/'.length); const q = new URLSearchParams(u.search); q.set('r', r);
      req.url = `/api/data?${q.toString()}`; return data(req, res);
    }
    const rel = p === '/' ? '/index.html' : decodeURIComponent(p);
    const file = path.join(pub, rel);
    if (!file.startsWith(pub + path.sep)) return send(res, 403, { error: 'dilarang' });
    const buf = await readFile(file).catch(() => null);
    if (!buf) return send(res, 404, { error: 'tidak ada' });
    return send(res, 200, buf, MIME[path.extname(file)] ?? 'application/octet-stream');
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 3199);
  createDevServer().listen(port, '127.0.0.1', () => console.log(`peniru Vercel monitor: http://127.0.0.1:${port}  (penyimpanan: ${process.env.MIRROR_FS_DIR ?? '(Blob)'})`));
}
