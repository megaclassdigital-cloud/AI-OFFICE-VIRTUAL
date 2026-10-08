// Bukti F1.10: handoff lewat plugin sungguhan. Issue uji harus ber-status in_progress dan ber-assignee agar boleh
// ke in_review, jadi di sini dipakai issue yang dibuat khusus lalu diserahkan ke agent QA lewat PATCH (tanpa wakeup run).
const A = 'http://127.0.0.1:3177/api';
const j = async (p, o) => { const r = await fetch(A + p, o); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
import { readFileSync } from 'node:fs';
const co = (await j('/companies')).find((c) => /edukasi/i.test(c.name));
const hr = (await j(`/companies/${co.id}/heartbeat-runs?limit=1`))[0];
const run = { companyId: co.id, agentId: hr.agentId, runId: hr.id, projectId: (await j(`/companies/${co.id}/projects`))[0].id };
const g = (f) => JSON.parse(readFileSync(`fixtures/golden/valid/${f}`, 'utf8'));
async function tool(name, parameters) {
  const r = await fetch(A + '/plugins/tools/execute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ tool: `aao-approval-gate:${name}`, parameters, runContext: run })) });
  const x = await r.json();
  return x.result?.data ?? x;
}
const b = JSON.stringify({ title: 'F1.10 uji handoff', description: 'Issue uji, tanpa assignee.', status: 'todo' });
const issue = await j(`/companies/${co.id}/issues`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(b) });
for (const [k, d] of [['carousel', '03-carousel.json'], ['verification-result', '02-verification-result.json'], ['carousel-design', '04-carousel-design.json'], ['research-output', '01-research-output.json']]) {
  await tool('attach_file', { issueId: issue.id, key: k, body: JSON.stringify(g(d)) });
}
console.log('render      :', JSON.stringify((({ passed, pngCount }) => ({ passed, pngCount }))(await tool('render_carousel', { issueId: issue.id, designPath: 'f19b/design.json' }))));
console.log('handoff dulu:', JSON.stringify(await tool('handoff_to_owner', { issueId: issue.id })));
console.log('QA          :', JSON.stringify((({ action, reason }) => ({ action, reason }))(await tool('qa_submit_result', { issueId: issue.id, llm: { textOk: true, designOk: true } }))));
console.log('handoff     :', JSON.stringify(await tool('handoff_to_owner', { issueId: issue.id })));
console.log('agent approve:', JSON.stringify(await tool('set_issue_status', { issueId: issue.id, status: 'approved' })).slice(0, 200));
const docs = await j(`/issues/${issue.id}/documents`);
console.log('dokumen     :', JSON.stringify((Array.isArray(docs) ? docs : docs.documents ?? []).map((d) => d.key)));
const h = await j(`/issues/${issue.id}/documents/handoff`);
console.log('--- handoff ---\n' + (h.body ?? JSON.stringify(h)).slice(0, 900));
