// Bukti F1.0d: panggil tool plugin lewat /api/plugins/tools/execute dengan teks Indonesia panjang.
const A = 'http://127.0.0.1:3177/api';
const j = async (p, o) => { const r = await fetch(A + p, o); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const cos = await j('/companies');
const co = cos.find((c) => /edukasi/i.test(c.name));
const agents = await j(`/companies/${co.id}/agents`);
const projects = await j(`/companies/${co.id}/projects`);
const body = JSON.stringify({ title: 'F1.0d uji tool plugin', description: 'Issue uji, tanpa assignee.', status: 'todo' });
const issue = await j(`/companies/${co.id}/issues`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, body });
const hr = (await j(`/companies/${co.id}/heartbeat-runs?limit=1`))[0]; // run nyata (tools/execute memeriksa kepemilikan)
const run = { companyId: co.id, agentId: hr.agentId, runId: hr.id, projectId: (projects[0] ?? issue).id ?? issue.projectId };
async function call(tool, parameters) {
  const b = JSON.stringify({ tool: `aao-approval-gate:${tool}`, parameters, runContext: run });
  const t0 = Date.now();
  const r = await fetch(A + '/plugins/tools/execute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(b) });
  const txt = await r.text();
  console.log(`${tool} HTTP ${r.status} ${Date.now() - t0}ms ${txt.slice(0, 220)}`);
}
const long = 'Ringkasan “kebijakan” ≥ 7 hari — pekerja × AI. '.repeat(120);
await call('set_issue_status', { issueId: issue.id, status: 'in_progress' });
await call('post_comment', { issueId: issue.id, body: long });
await call('attach_file', { issueId: issue.id, key: 'research-output', body: long });
await call('set_issue_status', { issueId: issue.id, status: 'done' }); // harus ditolak
await call('set_issue_status', { issueId: issue.id, status: 'in_review' });
const cm = await j(`/issues/${issue.id}/comments`);
console.log('komentar tersimpan:', (Array.isArray(cm) ? cm : cm.comments ?? []).map((c) => c.body?.length));
console.log('issue', issue.identifier ?? issue.id, 'bodyBytes', Buffer.byteLength(long), 'chars', long.length);
