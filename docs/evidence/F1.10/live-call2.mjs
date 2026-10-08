// Bukti F1.10 (jalur sukses): agent QA di-PAUSE dulu supaya penugasan issue tidak memicu run berbayar.
const A = 'http://127.0.0.1:3177/api';
const QA = '10c49ae8-894d-416a-868c-963b8899b878';
const j = async (p, o) => { const r = await fetch(A + p, o); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const jb = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body)) });
const co = (await j('/companies')).find((c) => /edukasi/i.test(c.name));
const runsBefore = (await j(`/companies/${co.id}/heartbeat-runs?limit=500`)).length;
const hr = (await j(`/companies/${co.id}/heartbeat-runs?limit=1`))[0];
const run = { companyId: co.id, agentId: hr.agentId, runId: hr.id, projectId: (await j(`/companies/${co.id}/projects`))[0].id };
async function tool(name, parameters) {
  const r = await fetch(A + '/plugins/tools/execute', jb('POST', { tool: `aao-approval-gate:${name}`, parameters, runContext: run }));
  const x = await r.json();
  return x.result?.data ?? x;
}
console.log('agent QA     :', (await j(`/agents/${QA}`)).status);
const issue = (await j(`/companies/${co.id}/issues`)).find((i) => i.title === 'F1.10 uji handoff');
const patched = await j(`/issues/${issue.id}`, jb('PATCH', { assigneeAgentId: QA, status: 'in_progress' }));
console.log('PATCH issue  :', patched.status ?? JSON.stringify(patched).slice(0, 200));
console.log('QA           :', JSON.stringify((({ action }) => ({ action }))(await tool('qa_submit_result', { issueId: issue.id, llm: { textOk: true, designOk: true } }))));
console.log('handoff      :', JSON.stringify(await tool('handoff_to_owner', { issueId: issue.id })));
console.log('agent approve:', JSON.stringify(await tool('set_issue_status', { issueId: issue.id, status: 'approved' })).slice(0, 160));
console.log('agent done   :', JSON.stringify(await tool('set_issue_status', { issueId: issue.id, status: 'done' })).slice(0, 160));
const after = await j(`/issues/${issue.id}`);
console.log('status issue :', after.status);
const h = await j(`/issues/${issue.id}/documents/handoff`);
console.log('--- dokumen handoff ---\n' + (h.body ?? JSON.stringify(h)).slice(0, 800));
console.log('run baru     :', (await j(`/companies/${co.id}/heartbeat-runs?limit=500`)).length - runsBefore);
