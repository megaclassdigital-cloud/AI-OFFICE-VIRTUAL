// loop-lib.js — shared, dependency-free logic for the AI Agent Office engineering loop.
// Used by .claude/hooks/loop-guard.js, .claude/hooks/session-start.js and scripts/loop-status.js.
// Source of truth for loop state: loop/backlog.json. Do not duplicate this logic elsewhere.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'OWNER', 'SKIPPED'];
const LOOP_STATUSES = ['RUNNING', 'PAUSED', 'DONE', 'HARD_STOP', 'STALLED'];
const SATISFIED = new Set(['DONE', 'SKIPPED']);
const OPEN = new Set(['TODO', 'IN_PROGRESS']);

function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..');
}

function backlogPath(root = projectDir()) {
  return path.join(root, 'loop', 'backlog.json');
}

function loadBacklog(root = projectDir()) {
  const raw = fs.readFileSync(backlogPath(root), 'utf8');
  return JSON.parse(raw);
}

function saveBacklog(backlog, root = projectDir()) {
  backlog.loop.updated_at = new Date().toISOString();
  fs.writeFileSync(backlogPath(root), JSON.stringify(backlog, null, 2) + '\n', 'utf8');
}

// Returns a list of human-readable problems; empty list = valid.
function validate(backlog) {
  const errors = [];
  if (!backlog || typeof backlog !== 'object') return ['backlog.json is not an object'];
  if (!backlog.loop || !LOOP_STATUSES.includes(backlog.loop.status)) {
    errors.push(`loop.status must be one of ${LOOP_STATUSES.join(', ')}`);
  }
  if (!Array.isArray(backlog.tasks) || backlog.tasks.length === 0) {
    errors.push('tasks must be a non-empty array');
    return errors;
  }
  const ids = new Set();
  let finals = 0;
  for (const t of backlog.tasks) {
    if (!t.id) { errors.push('a task has no id'); continue; }
    if (ids.has(t.id)) errors.push(`duplicate task id ${t.id}`);
    ids.add(t.id);
    if (!TASK_STATUSES.includes(t.status)) errors.push(`${t.id}: invalid status ${t.status}`);
    if (!Array.isArray(t.deps)) errors.push(`${t.id}: deps must be an array`);
    if (t.final) finals += 1;
    if ((t.status === 'BLOCKED' || t.status === 'OWNER') && !t.notes) {
      errors.push(`${t.id}: status ${t.status} requires notes explaining why`);
    }
    if (t.status === 'DONE' && !t.evidence) errors.push(`${t.id}: DONE requires an evidence path`);
  }
  for (const t of backlog.tasks) {
    for (const d of t.deps || []) if (!ids.has(d)) errors.push(`${t.id}: unknown dep ${d}`);
  }
  if (finals !== 1) errors.push(`exactly one task must have final: true (found ${finals})`);
  return errors;
}

function byId(backlog) {
  return new Map(backlog.tasks.map((t) => [t.id, t]));
}

function depsSatisfied(task, index) {
  return (task.deps || []).every((d) => SATISFIED.has((index.get(d) || {}).status));
}

// Next task the loop must work on, or null when nothing is actionable.
// Order: an IN_PROGRESS task first (finish what was started), then backlog order.
// The final task becomes actionable only when no other task is actionable.
function nextTask(backlog) {
  const index = byId(backlog);
  const normal = backlog.tasks.filter((t) => !t.final && OPEN.has(t.status) && depsSatisfied(t, index));
  const inProgress = normal.find((t) => t.status === 'IN_PROGRESS');
  if (inProgress) return inProgress;
  if (normal.length) return normal[0];
  const fin = backlog.tasks.find((t) => t.final && OPEN.has(t.status));
  return fin || null;
}

// Tasks whose hard-stop condition has fired.
function hardStops(backlog) {
  return backlog.tasks.filter((t) => t.hard_stop_on_block && t.status === 'BLOCKED');
}

function counts(backlog) {
  const c = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0]));
  for (const t of backlog.tasks) c[t.status] = (c[t.status] || 0) + 1;
  return c;
}

// Open tasks that can never start in this loop because a dependency (directly or transitively)
// is BLOCKED or OWNER. Returns [{ task, cause }] where cause is the blocking task id.
function waiting(backlog) {
  const index = byId(backlog);
  const memo = new Map();
  const stuckCause = (id, seen = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return null;
    seen.add(id);
    const t = index.get(id);
    let cause = null;
    for (const d of (t && t.deps) || []) {
      const dt = index.get(d);
      if (!dt) continue;
      if (dt.status === 'BLOCKED' || dt.status === 'OWNER') { cause = d; break; }
      const c = stuckCause(d, seen);
      if (c) { cause = c; break; }
    }
    memo.set(id, cause);
    return cause;
  };
  return backlog.tasks
    .filter((t) => !t.final && OPEN.has(t.status))
    .map((t) => ({ task: t, cause: stuckCause(t.id) }))
    .filter((x) => x.cause);
}

function fingerprint(backlog) {
  const essence = {
    loop: backlog.loop.status,
    tasks: backlog.tasks.map((t) => [t.id, t.status, t.attempts || 0, t.notes || '', t.evidence || '']),
  };
  return crypto.createHash('sha256').update(JSON.stringify(essence)).digest('hex');
}

// Pure decision used by the Stop hook. Returns { allow: boolean, reason: string, markStalled?: boolean }.
// guardState: { session_id, fingerprint, sameCount, totalBlocks }
function stopDecision(backlog, guardState, sessionId, opts = {}) {
  const maxSame = opts.maxSame ?? 3;
  const maxTotal = opts.maxTotal ?? 300;
  const status = backlog.loop.status;

  if (status !== 'RUNNING') {
    return { allow: true, reason: `loop.status = ${status}` };
  }
  if (process.env.AAO_LOOP_OFF === '1') {
    return { allow: true, reason: 'AAO_LOOP_OFF=1' };
  }

  const fp = fingerprint(backlog);
  const sameSession = guardState && guardState.session_id === sessionId;
  const sameCount = sameSession && guardState.fingerprint === fp ? guardState.sameCount + 1 : 1;
  const totalBlocks = sameSession ? guardState.totalBlocks + 1 : 1;

  if (sameCount > maxSame) {
    return {
      allow: true,
      markStalled: true,
      reason: `No change in loop/backlog.json across ${maxSame} consecutive stop attempts. Loop marked STALLED.`,
      state: { session_id: sessionId, fingerprint: fp, sameCount, totalBlocks },
    };
  }
  if (totalBlocks > maxTotal) {
    return {
      allow: true,
      markStalled: true,
      reason: `Safety limit: ${maxTotal} continuations in one session. Loop marked STALLED.`,
      state: { session_id: sessionId, fingerprint: fp, sameCount, totalBlocks },
    };
  }

  const state = { session_id: sessionId, fingerprint: fp, sameCount, totalBlocks };
  const stops = hardStops(backlog);
  if (stops.length) {
    return {
      allow: false,
      state,
      reason:
        `HARD STOP condition: ${stops.map((t) => t.id).join(', ')} is BLOCKED. ` +
        'Write reports/LOOP-HARD-STOP.md (what failed, evidence, options for the owner), ' +
        'set loop.status = "HARD_STOP" in loop/backlog.json, regenerate STATUS.md, then stop.',
    };
  }

  const next = nextTask(backlog);
  if (next) {
    const verb = next.final ? 'All other tasks are closed. Do the final task' : 'Continue the loop with';
    return {
      allow: false,
      state,
      reason:
        `${verb} ${next.id} — ${next.title}. Follow loop/LOOP.md (cycle steps 1-8). ` +
        'Do not ask the owner; use loop/DEFAULTS.md, record decisions in loop/DECISIONS.md, ' +
        'owner-only items in loop/OWNER-QUEUE.md. Update loop/backlog.json after every step.',
    };
  }

  return {
    allow: false,
    state,
    reason:
      'No actionable task remains but loop.status is still RUNNING. ' +
      'If the final task is DONE, set loop.status = "DONE"; otherwise close it. Then regenerate STATUS.md and stop.',
  };
}

function renderStatus(backlog, root = projectDir()) {
  const c = counts(backlog);
  const next = nextTask(backlog);
  const stops = hardStops(backlog);
  const wait = waiting(backlog);
  const readCount = (file, marker) => {
    try {
      return fs.readFileSync(path.join(root, 'loop', file), 'utf8').split('\n').filter((l) => l.startsWith(marker)).length;
    } catch { return 0; }
  };
  const ownerOpen = readCount('OWNER-QUEUE.md', '- [ ]');
  const decisions = readCount('DECISIONS.md', '## D-');
  const phases = [];
  for (const t of backlog.tasks) {
    let p = phases.find((x) => x.name === t.phase);
    if (!p) { p = { name: t.phase, total: 0, done: 0 }; phases.push(p); }
    p.total += 1;
    if (SATISFIED.has(t.status)) p.done += 1;
  }
  const row = (t) => `| ${t.id} | ${t.title} | ${t.status} | ${t.notes ? t.notes.replace(/\|/g, '/').slice(0, 120) : ''} |`;
  const lines = [
    '# STATUS',
    '',
    `> File ini dibuat otomatis oleh \`node scripts/loop-status.js --write-status\`. Jangan diedit manual.`,
    `> Terakhir diperbarui: ${new Date().toISOString()}`,
    '',
    `**Status loop:** ${backlog.loop.status}${backlog.loop.status_reason ? ' — ' + backlog.loop.status_reason : ''}`,
    `**Task berikutnya:** ${next ? `${next.id} — ${next.title}` : '(tidak ada)'}`,
    `**Ringkasan:** ${c.DONE} DONE · ${c.IN_PROGRESS} IN_PROGRESS · ${c.TODO} TODO · ${c.BLOCKED} BLOCKED · ${c.OWNER} OWNER · ${c.SKIPPED} SKIPPED`,
    `**Antrian owner:** ${ownerOpen} item terbuka (loop/OWNER-QUEUE.md) · **Keputusan tercatat:** ${decisions} (loop/DECISIONS.md)`,
    '',
    '## Progres per fase',
    '',
    '| Fase | Selesai | Total |',
    '| --- | --- | --- |',
    ...phases.map((p) => `| ${p.name} | ${p.done} | ${p.total} |`),
    '',
  ];
  if (stops.length) {
    lines.push('## HARD STOP', '', '| Task | Judul | Status | Catatan |', '| --- | --- | --- | --- |', ...stops.map(row), '');
  }
  const flagged = backlog.tasks.filter((t) => t.status === 'BLOCKED' || t.status === 'OWNER');
  if (flagged.length) {
    lines.push('## BLOCKED / menunggu owner', '', '| Task | Judul | Status | Catatan |', '| --- | --- | --- | --- |', ...flagged.map(row), '');
  }
  if (wait.length) {
    lines.push('## Tertahan karena task BLOCKED/OWNER', '', wait.map((w) => `- ${w.task.id} tertahan oleh ${w.cause}`).join('\n'), '');
  }
  return lines.join('\n');
}

module.exports = {
  TASK_STATUSES, LOOP_STATUSES, projectDir, backlogPath, loadBacklog, saveBacklog, validate,
  nextTask, hardStops, counts, waiting, fingerprint, stopDecision, renderStatus,
};
