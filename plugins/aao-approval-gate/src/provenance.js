// Provenance (FIX-G1-01/02/03): bukti yang ditulis KODE PLUGIN ke state plugin, bukan berkas/dokumen yang bisa ditulis agent.
//  - verify log   : setiap panggilan verify_candidate dicatat; QA menolak status "verified" tanpa catatan yang cocok.
//  - render seal  : render_carousel mengikat laporan visual + hash PNG ke hash dokumen carousel-design; QA memakai segel
//                   ini (bukan visual-qa.json/hashes.json di disk) dan menghitung ulang hash PNG dari disk.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, sha256 } from './content-hash.js';

const MAX_LOG = 200;
const PNG_RE = /^slide-\d+\.png$/;

export const verifyScope = (issueId) => ({ scopeKind: 'issue', scopeId: issueId, namespace: 'aao-verify', stateKey: 'log' });
export const renderScope = (issueId) => ({ scopeKind: 'issue', scopeId: issueId, namespace: 'aao-render', stateKey: 'seal' });

export const urlKey = (url) => sha256(String(url));
export const designHash = (design) => sha256(canonicalJson(design));

export async function recordVerification(ctx, issueId, { url, publishedAt, checks }) {
  const log = (await ctx.state.get(verifyScope(issueId))) ?? {};
  log[urlKey(url)] = {
    url, publishedAt,
    urlOk: checks.urlReachable.ok === true, dateOk: checks.dateWithinWindow.ok === true,
    httpStatus: checks.urlReachable.httpStatus ?? null, at: new Date().toISOString(),
  };
  const keys = Object.keys(log);
  if (keys.length > MAX_LOG) for (const k of keys.slice(0, keys.length - MAX_LOG)) delete log[k];
  await ctx.state.set(verifyScope(issueId), log);
}

/** Setiap hasil `verified` wajib punya catatan verify_candidate yang cocok (URL, lulus URL dan tanggal, cek yang diklaim sama). */
export function checkVerificationProvenance(verification, log) {
  const errors = [];
  for (const r of verification.results.filter((x) => x.status === 'verified')) {
    const rec = log?.[urlKey(r.url)];
    if (!rec) { errors.push(`kandidat ${r.candidateId}: tidak ada catatan verify_candidate untuk URL ini; status verified tidak dapat dipercaya`); continue; }
    if (!rec.urlOk || !rec.dateOk) errors.push(`kandidat ${r.candidateId}: catatan verify_candidate menunjukkan cek gagal (url=${rec.urlOk}, tanggal=${rec.dateOk}) tetapi status verified`);
    if (r.checks.urlReachable.ok !== rec.urlOk || r.checks.dateWithinWindow.ok !== rec.dateOk) errors.push(`kandidat ${r.candidateId}: checks di verification-result berbeda dari catatan verify_candidate`);
    if (r.checks.dateWithinWindow.publishedAt && rec.publishedAt && r.checks.dateWithinWindow.publishedAt !== rec.publishedAt) errors.push(`kandidat ${r.candidateId}: publishedAt berbeda dari yang diverifikasi`);
  }
  return errors;
}

export async function hashPngs(renderDir) {
  const files = (await readdir(renderDir).catch(() => [])).filter((f) => PNG_RE.test(f)).sort();
  const out = {};
  for (const f of files) out[f] = sha256(await readFile(path.join(renderDir, f)));
  return out;
}

/** Dipanggil render_carousel setelah renderer selesai: simpan laporan renderer + hash design yang dirender. */
export async function sealRender(ctx, issueId, { design, visualQa, hashes }) {
  await ctx.state.set(renderScope(issueId), { designHash: designHash(design), visualQa, hashes, at: new Date().toISOString() });
}

/** Bandingkan segel dengan dokumen carousel-design saat ini dan PNG di disk. */
export async function checkRenderSeal(seal, design, renderDir) {
  const errors = [];
  if (seal.designHash !== designHash(design)) errors.push('dokumen carousel-design berubah sejak render_carousel; render ulang');
  const disk = await hashPngs(renderDir);
  const sealed = seal.hashes ?? {};
  const names = new Set([...Object.keys(disk), ...Object.keys(sealed)]);
  for (const n of [...names].sort()) {
    if (disk[n] !== sealed[n]) errors.push(`${n}: ${disk[n] ? (sealed[n] ? 'isi PNG berbeda dari hasil render_carousel' : 'PNG tambahan tidak berasal dari render_carousel') : 'PNG hilang'}`);
  }
  return { errors };
}
