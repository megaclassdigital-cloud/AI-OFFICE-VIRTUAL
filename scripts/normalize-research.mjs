#!/usr/bin/env node
// normalize-research.mjs — mengubah keluaran mentah Researcher menjadi research-output.json (F1.2).
//
// Researcher (LLM) hanya menulis { candidates: [{title, summary, url, published_at, source_name}] }.
// KODE inilah yang menambahkan id (c01..), generatedAt, windowDays, dan flag non_whitelist,
// lalu memvalidasi terhadap skema. Pekerjaan administratif tidak diserahkan ke LLM.
//
// Pemakaian: node scripts/normalize-research.mjs <raw.json> [--out <file>] [--generated-at <ISO>]

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertValid } from '../schemas/validate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSources = path.join(root, 'divisions', 'edukasiai', 'sources.json');

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));

export function isWhitelisted(url, domains) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

export function normalizeResearch(raw, { sources, generatedAt = new Date().toISOString() } = {}) {
  if (!raw || !Array.isArray(raw.candidates)) throw new Error('keluaran Researcher tanpa array "candidates"');
  const cfg = sources ?? readJson(defaultSources);
  const out = {
    generatedAt,
    windowDays: cfg.windowDays ?? 7,
    candidates: raw.candidates.map((c, i) => {
      const cand = {
        id: `c${String(i + 1).padStart(2, '0')}`,
        title: c.title,
        summary: c.summary,
        url: c.url,
        published_at: c.published_at,
        source_name: c.source_name,
      };
      if (!isWhitelisted(c.url, cfg.whitelistDomains)) cand.non_whitelist = true;
      return cand;
    }),
  };
  return assertValid('research-output', out);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const arg = (n) => (a.includes(n) ? a[a.indexOf(n) + 1] : undefined);
  if (!a[0] || a[0].startsWith('--')) { console.error('Pemakaian: node scripts/normalize-research.mjs <raw.json> [--out f] [--generated-at ISO]'); process.exit(64); }
  try {
    const res = normalizeResearch(readJson(a[0]), { generatedAt: arg('--generated-at') });
    const text = JSON.stringify(res, null, 2) + '\n';
    if (arg('--out')) writeFileSync(arg('--out'), text, 'utf8'); else process.stdout.write(text);
  } catch (e) {
    console.error(`GAGAL: ${e.message}`);
    if (e.errors) for (const x of e.errors) console.error(`  ${x.path} ${x.message}`);
    process.exit(2);
  }
}
