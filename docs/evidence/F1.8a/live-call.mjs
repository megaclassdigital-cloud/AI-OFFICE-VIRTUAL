// Bukti F1.8a: render_carousel lewat /api/plugins/tools/execute (proses plugin sungguhan, bukan unit test).
const A = 'http://127.0.0.1:3177/api';
const j = async (p) => (await fetch(A + p)).json();
const co = (await j('/companies')).find((c) => /edukasi/i.test(c.name));
const hr = (await j(`/companies/${co.id}/heartbeat-runs?limit=1`))[0];
const run = { companyId: co.id, agentId: hr.agentId, runId: hr.id, projectId: (await j(`/companies/${co.id}/projects`))[0].id };
const issueId = (await j(`/companies/${co.id}/issues`)).find((i) => i.identifier === 'EDU-3')?.id;
async function call(parameters) {
  const t0 = Date.now();
  const r = await fetch(A + '/plugins/tools/execute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ tool: 'aao-approval-gate:render_carousel', parameters, runContext: run })) });
  const x = await r.json();
  const d = x.result?.data ?? x;
  console.log(`HTTP ${r.status} ${Date.now() - t0}ms`, JSON.stringify({ ok: d.ok, passed: d.passed, exitCode: d.exitCode, pngCount: d.pngCount, error: d.error ?? x.error, hashes: d.hashes }));
  return d;
}
const a = await call({ issueId, designPath: 'f18a/design.json' });
const b = await call({ issueId, designPath: 'f18a/design.json' });
console.log('hash identik antar-run:', JSON.stringify(a.hashes) === JSON.stringify(b.hashes));
await call({ issueId, designPath: '../package.json' });
