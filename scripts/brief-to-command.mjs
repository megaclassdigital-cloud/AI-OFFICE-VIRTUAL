#!/usr/bin/env node
// brief-to-command.mjs — validates a design brief (.md) against the brand kit and prints ONE valid Designer
// prompt. Deterministic: no LLM, no network. Usage: node scripts/brief-to-command.mjs <brief.md> [--out file]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const brand = path.join(root, 'divisions', 'edukasiai', 'brand');

/** Minimal front-matter reader for the flat subset used by briefs (scalars, inline lists, one nested map). */
export function parseBrief(text) {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error('brief tidak punya front matter --- ... ---');
  const meta = {}; let nested = null;
  for (const raw of m[1].split('\n')) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const ind = /^\s+/.test(line);
    const kv = line.trim().match(/^([A-Za-z]+):\s*(.*)$/);
    if (!kv) throw new Error(`baris front matter tidak dikenal: ${raw}`);
    const [, k, v] = kv;
    if (ind && nested) { meta[nested][k] = v; continue; }
    nested = null;
    if (v === '') { meta[k] = {}; nested = k; }
    else if (v.startsWith('[')) meta[k] = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    else meta[k] = v;
  }
  return { meta, body: m[2].trim() };
}

/** Returns { errors: string[] } — every problem, not just the first. */
export function validateBrief(meta, { variants, templates, icons }) {
  const errors = [];
  if (!meta.judul) errors.push('judul wajib');
  if (!meta.colorVariant) errors.push('colorVariant wajib');
  else if (!variants.includes(meta.colorVariant)) errors.push(`colorVariant '${meta.colorVariant}' tidak ada (${variants.join('|')})`);
  const roles = ['hook', 'point', 'stat', 'quote', 'comparison', 'cta'];
  for (const [role, t] of Object.entries(meta.templateHint ?? {})) {
    if (!roles.includes(role)) errors.push(`peran '${role}' tidak dikenal`);
    if (!templates.includes(t)) errors.push(`template '${t}' tidak ada (${templates.join('|')})`);
  }
  for (const i of meta.icons ?? []) if (!icons.includes(i)) errors.push(`ikon '${i}' tidak ada di brand kit`);
  return { errors };
}

export function buildCommand(meta, body, issueId = '<issueId>') {
  const hints = Object.entries(meta.templateHint ?? {}).map(([r, t]) => `${r}→${t}`).join(', ') || '(tidak ada)';
  return [
    `Tugas Designer untuk issue ${issueId}: isi carousel-design.json dari carousel.json Copywriter mengikuti BRIEF di bawah.`,
    `Brief hanya memengaruhi pilihan sah brand kit. Fakta slide (angka, nama, tanggal) tidak boleh berubah. Jangan baca gambar apa pun; brief ini sudah disaring owner.`,
    `colorVariant: ${meta.colorVariant}`,
    `templateHint: ${hints}`,
    `icons: ${(meta.icons ?? []).join(', ') || '(bebas dari set lokal)'}`,
    `emphasis: ${meta.emphasis ?? '(sesuai aturan umum)'}`,
    `BRIEF "${meta.judul}":`,
    body,
    `Laporkan di summary complete_stage: tiga poin brief yang dipakai dan apa yang tidak bisa dipenuhi brand kit.`,
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, ...rest] = process.argv.slice(2);
  if (!file) { console.error('Pemakaian: node scripts/brief-to-command.mjs <brief.md> [--out file]'); process.exit(2); }
  const { meta, body } = parseBrief(readFileSync(file, 'utf8'));
  const b = JSON.parse(readFileSync(path.join(brand, 'brand.json'), 'utf8'));
  const t = JSON.parse(readFileSync(path.join(brand, 'templates.json'), 'utf8'));
  const icons = existsSync(path.join(brand, 'icons')) ? (await import('node:fs')).readdirSync(path.join(brand, 'icons')).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)) : [];
  const { errors } = validateBrief(meta, { variants: Object.keys(b.variants), templates: Object.keys(t.templates ?? t), icons });
  if (errors.length) { console.error('Brief TIDAK valid:\n- ' + errors.join('\n- ')); process.exit(1); }
  const cmd = buildCommand(meta, body);
  const o = rest.indexOf('--out');
  if (o >= 0) { writeFileSync(rest[o + 1], cmd + '\n'); console.log(`Perintah ditulis ke ${rest[o + 1]}`); } else console.log(cmd);
}
