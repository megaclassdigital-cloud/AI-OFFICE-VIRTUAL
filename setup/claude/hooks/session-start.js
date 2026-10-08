#!/usr/bin/env node
// SessionStart hook: prints loop state so every new session (or context reset) resumes from files, not memory.
'use strict';
const path = require('path');
const lib = require(path.join(__dirname, '..', '..', 'loop', 'loop-lib.js'));

try {
  const b = lib.loadBacklog();
  const c = lib.counts(b);
  const next = lib.nextTask(b);
  const problems = lib.validate(b);
  const out = [
    '=== AI AGENT OFFICE — ENGINEERING LOOP ===',
    `Loop status: ${b.loop.status}`,
    `Tasks: ${c.DONE} DONE, ${c.IN_PROGRESS} IN_PROGRESS, ${c.TODO} TODO, ${c.BLOCKED} BLOCKED, ${c.OWNER} OWNER`,
    `Next task: ${next ? `${next.id} — ${next.title}` : '(none)'}`,
    problems.length ? `backlog.json problems: ${problems.join('; ')}` : 'backlog.json: valid',
    '',
    b.loop.status === 'RUNNING'
      ? 'Mode: LOOP. Read loop/LOOP.md, then work task by task without asking the owner. ' +
        'Only the HARD STOP list in loop/LOOP.md justifies stopping.'
      : 'Loop is not RUNNING. Do only what the owner asks in this session.',
  ];
  process.stdout.write(out.join('\n') + '\n');
} catch (e) {
  process.stdout.write(`[session-start] could not read loop/backlog.json: ${e.message}\n`);
}
