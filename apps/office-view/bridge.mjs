// office-bridge: membaca Paperclip (HANYA GET) dan mengubah perubahan datanya menjadi event kantor.
// Tidak ada tulis ke Paperclip, tidak ada LLM. Event tidak pernah dipalsukan: setiap event berasal dari perbedaan
// antara dua pembacaan data nyata. Pembacaan pertama menjadi snapshot (keadaan terkini), bukan rangkaian event.

const FAIL = new Set(['failed', 'error', 'timed_out', 'timeout']);
const RUNNING = new Set(['running', 'queued']);
const FAIL_WINDOW_MS = 15 * 60_000;
const ACTIVE_COMMENT_WINDOW_MS = 15 * 60_000;
const MAX_TRACKED_ISSUES = 8;
const RING = 500;
const DOWN_AFTER_FAILURES = 3; // satu poll lambat/gagal tidak boleh menandai Paperclip putus (mencegah resync dan teleport)

export function createBridge({ base = 'http://127.0.0.1:3177', fetchImpl = fetch, now = () => Date.now(), companyPattern = /edukasi/i, log = () => {} } = {}) {
  const api = base.replace(/\/$/, '') + '/api';
  const st = {
    epoch: 1, seq: 0, events: [], connected: false, error: null, lastOkAt: null, lastPollMs: null, company: null,
    prev: null, // { agents:Map, issues:Map, comments:Set, ownerCount }
    needsResync: false, failures: 0,
  };

  async function get(path) {
    const r = await fetchImpl(api + path, { method: 'GET', signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Paperclip HTTP ${r.status} ${path}`);
    return r.json();
  }

  async function resolveCompany() {
    if (st.company) return st.company;
    const list = await get('/companies');
    const c = list.find((x) => companyPattern.test(x.name) && !/mega\s*class/i.test(x.name));
    if (!c) throw new Error('company EdukasiAI tidak ditemukan');
    st.company = { id: c.id, name: c.name };
    return st.company;
  }

  function derive(agents, issues, runs) {
    const nowMs = now();
    const runById = new Map(runs.map((r) => [r.id, r]));
    const out = new Map();
    for (const a of agents) {
      const myRuns = runs.filter((r) => r.agentId === a.id).sort((x, y) => (Date.parse(y.startedAt ?? y.createdAt ?? 0) || 0) - (Date.parse(x.startedAt ?? x.createdAt ?? 0) || 0));
      const running = myRuns.find((r) => RUNNING.has(r.status));
      const latest = myRuns[0];
      const assigned = issues.filter((i) => i.assigneeAgentId === a.id);
      const blocked = assigned.find((i) => i.status === 'blocked');
      let issue = null;
      let state = 'idle';
      let reason;
      if (running || a.status === 'running') {
        state = 'working';
        const byRun = running ? issues.find((i) => i.executionRunId === running.id || i.checkoutRunId === running.id) : null;
        issue = byRun ?? assigned.find((i) => i.status === 'in_progress') ?? null;
      } else if (a.status === 'paused') {
        state = 'paused'; reason = a.pauseReason ?? undefined;
      } else if (blocked) {
        state = 'alert'; issue = blocked; reason = 'needs_human';
      } else if (a.status === 'error') {
        // Status error di Paperclip menetap sampai dibersihkan: agent tetap di Pojok Bug selama itu benar.
        state = 'failed'; reason = latest?.errorCode ?? a.errorReason ?? 'error';
      } else if (latest && FAIL.has(latest.status) && nowMs - (Date.parse(latest.finishedAt ?? latest.startedAt ?? 0) || 0) < FAIL_WINDOW_MS) {
        state = 'failed'; reason = latest.errorCode ?? latest.error ?? latest.status;
      }
      void runById;
      out.set(a.id, { agentId: a.id, name: a.name, role: a.role, state, reason: reason ? String(reason).slice(0, 80) : undefined, issue: issue ? { id: issue.id, identifier: issue.identifier, title: issue.title } : null });
    }
    return out;
  }

  const issueRef = (i) => ({ id: i.id, identifier: i.identifier, title: i.title });
  const push = (ev, observedAt) => { st.seq += 1; st.events.push({ seq: st.seq, observedAt, ...ev }); if (st.events.length > RING) st.events.shift(); };

  async function poll() {
    const t0 = now();
    try {
      const co = await resolveCompany();
      const [agents, issues, runs] = await Promise.all([get(`/companies/${co.id}/agents`), get(`/companies/${co.id}/issues`), get(`/companies/${co.id}/heartbeat-runs?limit=40`)]);
      const tracked = issues
        .filter((i) => ['in_progress', 'in_review', 'blocked', 'todo'].includes(i.status) && t0 - (Date.parse(i.lastActivityAt ?? i.updatedAt ?? 0) || 0) < ACTIVE_COMMENT_WINDOW_MS)
        .slice(0, MAX_TRACKED_ISSUES);
      const commentLists = await Promise.all(tracked.map(async (i) => {
        const r = await get(`/issues/${i.id}/comments`).catch(() => []);
        return [i, Array.isArray(r) ? r : r.comments ?? []];
      }));
      const agentState = derive(agents, issues, runs);
      const inReview = issues.filter((i) => i.status === 'in_review');
      const seenComments = new Set();
      for (const [, list] of commentLists) for (const c of list) seenComments.add(c.id);

      const wasDown = !st.connected && st.prev !== null;
      st.failures = 0; st.connected = true; st.error = null; st.lastOkAt = t0;

      if (!st.prev || wasDown) {
        // Pembacaan pertama (atau pulih dari putus): hanya snapshot, tanpa event gerak palsu.
        if (wasDown) { st.epoch += 1; st.events = []; }
        st.prev = { agents: agentState, issues: new Map(issues.map((i) => [i.id, { assignee: i.assigneeAgentId, status: i.status }])), comments: seenComments, ownerCount: inReview.length, agentsRaw: agents, inReview };
        st.lastPollMs = now() - t0;
        return;
      }

      const p = st.prev;
      // 1) perubahan assignee -> handoff; perubahan status ke in_review -> deliver
      for (const i of issues) {
        const before = p.issues.get(i.id);
        if (!before) continue;
        if (before.assignee && i.assigneeAgentId && before.assignee !== i.assigneeAgentId) {
          push({ type: 'handoff', from: before.assignee, to: i.assigneeAgentId, issue: issueRef(i) }, t0);
        }
        if (before.status !== 'in_review' && i.status === 'in_review') {
          const who = i.assigneeAgentId ?? before.assignee;
          if (who) push({ type: 'deliver', agentId: who, issue: issueRef(i), count: inReview.length }, t0);
        }
      }
      // 2) komentar baru
      for (const [i, list] of commentLists) {
        for (const c of list) {
          if (p.comments.has(c.id)) continue;
          const who = c.authorAgentId ?? i.assigneeAgentId;
          // excerpt = data teks dari Paperclip, hanya ditampilkan sebagai teks di kanvas (tidak pernah dieksekusi)
          const excerpt = String(c.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
          if (who) push({ type: 'comment', agentId: who, issue: issueRef(i), ...(c.authorAgentId ? {} : { fromOwner: true }), ...(excerpt ? { excerpt } : {}) }, t0);
        }
      }
      // 3) perubahan state agent
      for (const [id, s] of agentState) {
        const b = p.agents.get(id);
        if (!b || b.state !== s.state || b.issue?.id !== s.issue?.id) push({ type: 'agent.state', ...s }, t0);
      }
      // 4) antrean owner
      if (inReview.length !== p.ownerCount) {
        const grew = inReview.length > p.ownerCount;
        if (!grew || !st.events.some((e) => e.type === 'deliver' && e.seq > st.seq - 3)) push({ type: 'owner.queue', count: inReview.length, issues: inReview.map((i) => i.identifier) }, t0);
      }
      for (const c of seenComments) p.comments.add(c);
      st.prev = { ...p, agents: agentState, issues: new Map(issues.map((i) => [i.id, { assignee: i.assigneeAgentId, status: i.status }])), comments: p.comments, ownerCount: inReview.length, agentsRaw: agents, inReview };
      st.lastPollMs = now() - t0;
    } catch (e) {
      st.failures += 1; st.error = String(e?.message ?? e); st.company = null;
      if (st.failures >= DOWN_AFTER_FAILURES) st.connected = false;
      log(`bridge: ${st.error} (gagal ke-${st.failures})`);
    }
  }

  function snapshot() {
    const events = [];
    if (st.prev) {
      for (const s of st.prev.agents.values()) events.push({ type: 'agent.state', ...s, silent: true });
      events.push({ type: 'owner.queue', count: st.prev.ownerCount, issues: st.prev.inReview.map((i) => i.identifier) });
    }
    return { epoch: st.epoch, seq: st.seq, connected: st.connected, error: st.error, company: st.company?.name ?? null, events };
  }
  const eventsSince = (since) => ({ epoch: st.epoch, seq: st.seq, connected: st.connected, error: st.error, events: st.events.filter((e) => e.seq > since) });
  const status = () => ({ connected: st.connected, error: st.error, lastOkAt: st.lastOkAt, lastPollMs: st.lastPollMs, epoch: st.epoch, seq: st.seq, base });

  return { poll, snapshot, eventsSince, status, _state: st };
}
