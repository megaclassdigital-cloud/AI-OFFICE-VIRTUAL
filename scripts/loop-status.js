#!/usr/bin/env node
// Usage:
//   node scripts/loop-status.js                 print summary
//   node scripts/loop-status.js --check         validate loop/backlog.json (exit 1 on problems)
//   node scripts/loop-status.js --write-status  regenerate STATUS.md from loop/backlog.json
//   node scripts/loop-status.js --next          print only the next task id
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require(path.join(__dirname, '..', 'loop', 'loop-lib.js'));

const root = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const backlog = lib.loadBacklog(root);
const problems = lib.validate(backlog);

if (args.has('--check')) {
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log(`backlog.json valid: ${backlog.tasks.length} tasks`);
  process.exit(0);
}
if (args.has('--next')) {
  const n = lib.nextTask(backlog);
  console.log(n ? n.id : '');
  process.exit(0);
}
const text = lib.renderStatus(backlog, root);
if (args.has('--write-status')) {
  fs.writeFileSync(path.join(root, 'STATUS.md'), text + '\n', 'utf8');
  console.log('STATUS.md written');
} else {
  console.log(text);
}
if (problems.length) { console.error('\nbacklog.json problems:\n' + problems.join('\n')); process.exit(1); }
