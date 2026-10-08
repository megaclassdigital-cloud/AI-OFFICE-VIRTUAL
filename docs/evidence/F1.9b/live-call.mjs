// Bukti F1.9b: qa_submit_result lewat plugin sungguhan. Issue A = jalur lolos. Issue B = gagal 3 kali (AC1.4).
import { readFileSync } from 'node:fs';
const A = 'http://127.0.0.1:3177/api';
const j = async (p, o) => { const r = await fetch(A + p, o); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const co = (await j('/companies')).find((c) => /edukasi/i.test(c.name));
const hr = (await j(`/companies/${co.id}/heartbeat-runs?limit=1`))[0];
const run = { companyId: co.id, agentId: hr.agentId, runId: hr.id, projectId: (await j(`/companies/${co.id}/projects`))[0].id };
const g = (f) => JSON.parse(readFileSync(`fixtures/golden/valid/${f}`, 'utf8'));
async function tool(name, parameters) {
  const r = await fetch(A + '/plugins/tools/execute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ tool: `aao-approval-gate:${name}`, parameters, runContext: run })) });
  const x = await r.json();
  return x.result?.data ?? x;
}
const newIssue = async (title) => {
  const b = JSON.stringify({ title, description: 'Issue uji F1.9b, tanpa assignee.', status: 'todo' });
  return j(`/companies/${co.id}/issues`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(b) });
};
const attach = (issueId, key, doc) => tool('attach_file', { issueId, key, body: JSON.stringify(doc) });
async function setup(issueId, carousel) {
  await attach(issueId, 'carousel', carousel);
  await attach(issueId, 'verification-result', g('02-verification-result.json'));
  await attach(issueId, 'carousel-design', g('04-carousel-design.json'));
  await attach(issueId, 'research-output', g('01-research-output.json'));
}

const a = await newIssue('F1.9b jalur lolos');
await setup(a.id, g('03-carousel.json'));
console.log('render A :', JSON.stringify((({ passed, pngCount }) => ({ passed, pngCount }))(await tool('render_carousel', { issueId: a.id, designPath: 'f19b/design.json' }))));
const ra = await tool('qa_submit_result', { issueId: a.id, llm: { textOk: true, designOk: true } });
console.log('QA A     :', JSON.stringify(ra));

const bad = g('03-carousel.json');
bad.slides[1].body = 'Sebanyak 87 persen perusahaan sudah memakainya.';
bad.slides[1].emphasis = [];
const b = await newIssue('F1.9b jalur gagal');
await setup(b.id, bad);
await tool('render_carousel', { issueId: b.id, designPath: 'f19b/design.json' });
for (let i = 1; i <= 3; i++) {
  const r = await tool('qa_submit_result', { issueId: b.id, llm: { textOk: true, designOk: true } });
  console.log(`QA B #${i} :`, JSON.stringify({ action: r.action, reason: r.reason, rounds: r.rounds, ok: r.ok, error: r.error }));
}
const comments = await j(`/issues/${b.id}/comments`);
console.log('komentar B:', (Array.isArray(comments) ? comments : comments.comments ?? []).length, '| contoh:', ((Array.isArray(comments) ? comments : comments.comments ?? [])[0]?.body ?? '').split('\n').slice(0, 3).join(' / '));
