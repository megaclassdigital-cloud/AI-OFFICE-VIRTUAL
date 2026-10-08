#!/usr/bin/env node
// Stop hook: keeps Claude Code working while loop/backlog.json still has actionable tasks.
// Allows the stop only when loop.status is DONE / HARD_STOP / STALLED, or when the stall guard fires.
// Never crashes the session: on internal error it allows the stop and explains why on stderr.
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require(path.join(__dirname, '..', '..', 'loop', 'loop-lib.js'));

const root = lib.projectDir();
const guardFile = path.join(root, 'loop', '.guard-state.json');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function main() {
  let input = {};
  try { input = JSON.parse(readStdin() || '{}'); } catch { input = {}; }
  const sessionId = input.session_id || 'unknown-session';

  let guardState = null;
  try { guardState = JSON.parse(fs.readFileSync(guardFile, 'utf8')); } catch { guardState = null; }

  let backlog;
  try {
    backlog = lib.loadBacklog(root);
  } catch (e) {
    // Unreadable backlog: ask Claude to repair it, but give up after 3 consecutive failures.
    const sameSession = guardState && guardState.session_id === sessionId;
    const readErrors = (sameSession && guardState.readErrors) || 0;
    if (readErrors >= 3) {
      process.stderr.write(`[loop-guard] backlog.json unreadable 3 times in a row, stop allowed: ${e.message}\n`);
      return;
    }
    const base = sameSession ? guardState : { session_id: sessionId, sameCount: 0, totalBlocks: 0 };
    fs.writeFileSync(guardFile, JSON.stringify({ ...base, readErrors: readErrors + 1 }, null, 2));
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: `loop/backlog.json cannot be read (${e.message}). Repair it (valid JSON, schema in loop/LOOP.md) and continue the loop.`,
    }));
    return;
  }

  const problems = lib.validate(backlog);

  const d = lib.stopDecision(backlog, guardState, sessionId);
  if (d.state) fs.writeFileSync(guardFile, JSON.stringify(d.state, null, 2));

  if (d.markStalled) {
    backlog.loop.status = 'STALLED';
    backlog.loop.status_reason = d.reason;
    lib.saveBacklog(backlog, root);
    try { fs.writeFileSync(path.join(root, 'STATUS.md'), lib.renderStatus(backlog, root) + '\n'); } catch {}
    process.stderr.write(`[loop-guard] ${d.reason}\n`);
    return; // exit 0 without decision = stop allowed
  }
  if (d.allow) return;

  const reason = problems.length
    ? `${d.reason} ALSO FIX backlog.json problems first: ${problems.join('; ')}`
    : d.reason;
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

try { main(); } catch (e) {
  process.stderr.write(`[loop-guard] internal error, stop allowed: ${e.stack || e}\n`);
}
