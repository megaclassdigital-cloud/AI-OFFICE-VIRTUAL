#!/usr/bin/env node
// plan-release.mjs — owner menyetujui rencana Manager yang ditahan (mode tinjau): orkestrator melepasnya di tick berikutnya.
// Pemakaian: node scripts/plan-release.mjs EDU-58
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
if (!/^EDU-[0-9]+$/.test(id ?? '')) { console.error('Pemakaian: node scripts/plan-release.mjs EDU-<n>'); process.exit(64); }
const dir = path.join(root, 'workspace', 'agent', 'holds');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, `${id}.release`), JSON.stringify({ at: Date.now() }) + String.fromCharCode(10), 'utf8');
console.log(`Rencana ${id} dilepas; orkestrator melanjutkannya dalam beberapa detik.`);
