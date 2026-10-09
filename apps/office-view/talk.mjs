// Talk panel backend (opt-in via --enable-talk). Lets the owner send a message to the division Manager from
// Office View. This is the ONLY write path in Office View: it creates an issue assigned to the Manager (or adds an
// owner comment to an issue created here). Loopback only, same-origin only, size and rate limited. No LLM here.
const MAX_TEXT = 4000;
const MIN_GAP_MS = 5000;

export function createTalk({ base, port, managerName = 'Manager', companyMatch = /edukasi/i, now = () => Date.now() }) {
  const issues = new Set();
  let last = 0;
  let cache = null;

  const api = async (p, init = {}) => {
    const r = await fetch(base + '/api' + p, init);
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = t; }
    if (!r.ok) throw new Error(`Paperclip ${r.status} ${typeof j === 'string' ? j.slice(0, 120) : (j?.error ?? '')}`);
    return j;
  };
  const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body), 'utf8') });

  async function target() {
    if (cache) return cache;
    const company = (await api('/companies')).find((c) => companyMatch.test(c.name));
    if (!company) throw new Error('company EdukasiAI tidak ditemukan');
    const manager = (await api(`/companies/${company.id}/agents`)).find((a) => a.name === managerName);
    if (!manager) throw new Error(`agent ${managerName} tidak ditemukan`);
    const project = (await api(`/companies/${company.id}/projects`))[0];
    cache = { companyId: company.id, managerId: manager.id, projectId: project?.id };
    return cache;
  }

  const sameOrigin = (req) => {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}`) return false;
    const o = req.headers.origin;
    return !o || o === `http://127.0.0.1:${port}`;
  };

  async function readBody(req) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > 32 * 1024) throw Object.assign(new Error('terlalu besar'), { code: 413 }); chunks.push(c); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }

  /** Returns true when the request was handled here. */
  return async function handle(req, res, u, json) {
    if (!u.pathname.startsWith('/api/talk')) return false;
    try {
      if (u.pathname === '/api/talk/info' && req.method === 'GET') { json(res, 200, { enabled: true, to: managerName }); return true; }
      if (u.pathname === '/api/talk/thread' && req.method === 'GET') {
        const id = u.searchParams.get('issue') ?? '';
        if (!issues.has(id)) { json(res, 404, { error: 'issue bukan dari panel ini' }); return true; }
        const [issue, comments] = await Promise.all([api(`/issues/${id}`), api(`/issues/${id}/comments`)]);
        json(res, 200, {
          issue: { id, identifier: issue.identifier, status: issue.status },
          comments: comments.slice().reverse().map((c) => ({ from: c.authorType === 'agent' ? managerName : 'Owner', body: String(c.body ?? ''), at: c.createdAt })),
        });
        return true;
      }
      if (u.pathname === '/api/talk' && req.method === 'POST') {
        if (!sameOrigin(req)) { json(res, 403, { error: 'origin ditolak' }); return true; }
        if (now() - last < MIN_GAP_MS) { json(res, 429, { error: 'tunggu beberapa detik antar pesan' }); return true; }
        const { text, issueId } = await readBody(req);
        const msg = typeof text === 'string' ? text.trim() : '';
        if (!msg || msg.length > MAX_TEXT) { json(res, 400, { error: `pesan 1-${MAX_TEXT} karakter` }); return true; }
        last = now();
        const t = await target();
        if (issueId) {
          if (!issues.has(issueId)) { json(res, 404, { error: 'issue bukan dari panel ini' }); return true; }
          await post(`/issues/${issueId}/comments`, { body: msg });
          json(res, 200, { issueId, kind: 'comment' });
          return true;
        }
        const issue = await post(`/companies/${t.companyId}/issues`, {
          title: `Arahan owner: ${msg.replace(/\s+/g, ' ').slice(0, 60)}`,
          description: msg, status: 'todo', projectId: t.projectId, assigneeAgentId: t.managerId,
        });
        issues.add(issue.id);
        json(res, 200, { issueId: issue.id, identifier: issue.identifier, kind: 'issue' });
        return true;
      }
      json(res, 405, { error: 'metode tidak didukung' });
      return true;
    } catch (e) {
      json(res, e.code === 413 ? 413 : 502, { error: String(e?.message ?? e) });
      return true;
    }
  };
}
