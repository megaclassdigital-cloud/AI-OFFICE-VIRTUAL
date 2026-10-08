// Validator skema bersama (ajv, JSON Schema draft 2020-12).
//
// SATU modul untuk semua script dan tool plugin (F1.0b). Jangan membuat validator lain di tempat lain:
// dua validator yang sedikit berbeda adalah cara paling cepat membuat satu tahap meloloskan data yang
// ditolak tahap lain.
//
// Pemakaian:
//   import { validate, assertValid, SCHEMA_NAMES } from '../schemas/validate.mjs';
//   const r = validate('carousel', data);          // { ok, errors: [{ path, message, keyword }] }
//   assertValid('research-output', data);          // melempar SchemaError bila tidak valid
//
// Berjalan di Node murni (tanpa bundler), jadi aman di-import dari plugin worker.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const dir = path.dirname(fileURLToPath(import.meta.url));

/** Nama skema = nama berkas tanpa .json di folder schemas/. */
export const SCHEMA_NAMES = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

export class SchemaError extends Error {
  constructor(schemaName, errors) {
    super(`Data tidak sesuai skema "${schemaName}":\n` + errors.map((e) => `  - ${e.path || '(root)'}: ${e.message}`).join('\n'));
    this.name = 'SchemaError';
    this.schemaName = schemaName;
    this.errors = errors;
  }
}

let ajv;
const compiled = new Map();

function getAjv() {
  if (ajv) return ajv;
  // strict: true agar salah ketik kata kunci di skema ketahuan, bukan diam-diam diabaikan.
  ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const name of SCHEMA_NAMES) {
    const schema = JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8'));
    ajv.addSchema(schema, name);
  }
  return ajv;
}

function getValidator(name) {
  if (!SCHEMA_NAMES.includes(name)) {
    throw new Error(`Skema tidak dikenal: "${name}". Yang ada: ${SCHEMA_NAMES.join(', ')}`);
  }
  if (!compiled.has(name)) compiled.set(name, getAjv().getSchema(name));
  return compiled.get(name);
}

function formatErrors(errors) {
  return (errors ?? []).map((e) => ({
    path: e.instancePath,
    keyword: e.keyword,
    message: e.keyword === 'additionalProperties' ? `properti tidak dikenal "${e.params.additionalProperty}"` : e.message,
  }));
}

/** @returns {{ ok: boolean, errors: { path: string, keyword: string, message: string }[] }} */
export function validate(name, data) {
  const fn = getValidator(name);
  const ok = fn(data) === true;
  return { ok, errors: ok ? [] : formatErrors(fn.errors) };
}

/** Melempar SchemaError bila data tidak valid; mengembalikan data bila valid. */
export function assertValid(name, data) {
  const r = validate(name, data);
  if (!r.ok) throw new SchemaError(name, r.errors);
  return data;
}
