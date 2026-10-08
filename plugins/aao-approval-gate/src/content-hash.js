// Hash konten paket (F1.10): satu-satunya definisi "paket yang sama" untuk handoff dan (nanti) approval F2.1.
// Bentuk keluaran mengikuti schemas/approval-record.json -> content_hash.

import { createHash } from 'node:crypto';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** JSON.stringify dengan urutan kunci tetap, supaya hash tidak bergantung pada urutan properti. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * @param {{carousel:object, design:object}} docs
 * @param {Record<string,string>} fileHashes  nama file PNG -> sha256 (hashes.json renderer)
 */
export function packageContentHash({ carousel, design }, fileHashes) {
  const files = Object.keys(fileHashes).sort().map((p) => ({ path: p, sha256: fileHashes[p] }));
  const text = sha256(canonicalJson({ carousel, design }));
  const combined = sha256(`${text}\n${files.map((f) => `${f.path}:${f.sha256}`).join('\n')}`);
  return { algorithm: 'sha256', combined, text, files };
}
