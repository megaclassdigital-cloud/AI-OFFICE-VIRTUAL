// Bukti F1.3: tool verify_candidate lewat tools/execute terhadap URL publik nyata (dari keluaran nyata F0.2) dan URL salah.
import { readFileSync } from 'node:fs';
const A = 'http://127.0.0.1:3177/api';
const j = async (p) => (await fetch(A + p)).json();
const co = (await j('/companies')).find((c) => /edukasi/i.test(c.name));
const hr = (await j(`/companies/${co.id}/heartbeat-runs?limit=1`))[0];
const run = { companyId: co.id, agentId: hr.agentId, runId: hr.id, projectId: (await j(`/companies/${co.id}/projects`))[0].id };
const raw = JSON.parse(readFileSync('docs/spike/evidence/F0.2-research-output.json', 'utf8').replace(/^﻿/, ''));
async function call(parameters) {
  const t0 = Date.now();
  const r = await fetch(A + '/plugins/tools/execute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ tool: 'aao-approval-gate:verify_candidate', parameters, runContext: run })) });
  const x = await r.json();
  console.log(`${parameters.url.slice(0, 70)}\n  HTTP ${r.status} ${Date.now() - t0}ms`, JSON.stringify(x.result?.data ?? x));
}
await call({ url: raw.candidates[0].url, published_at: raw.candidates[0].published_at, windowDays: 30 });
await call({ url: 'https://apnews.com/article/halaman-yang-tidak-ada-0000', published_at: '2026-10-07' });
await call({ url: 'http://127.0.0.1:3177/api/health', published_at: '2026-10-07' });
await call({ url: 'https://example.com/', published_at: '2020-01-01' });
