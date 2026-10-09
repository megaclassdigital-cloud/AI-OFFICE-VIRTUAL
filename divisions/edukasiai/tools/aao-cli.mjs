// aao-cli.mjs — pure argument parsing for aao-tool.mjs (no I/O except an injected file reader), so it can be unit-tested.
//
// Why shorthands: agents on Windows PowerShell repeatedly failed to pass inline JSON (quotes, '&', backticks) and burned
// minutes retrying. Plain-text commands avoid JSON entirely:
//   say "teks komentar"                -> post_comment { body }
//   done "ringkasan"                   -> complete_stage { outcome: awaiting_approval, summary }
//   need-human "alasan"                -> complete_stage { outcome: needs_human, summary }
//   (any of them) --text-file <path>   -> text read from a UTF-8 file instead of arguments (long or tricky text)
// Classic forms still work:  <tool> '<json>'   and   <tool> --file params.json

const SHORTHANDS = {
  say: { tool: 'post_comment', field: 'body' },
  done: { tool: 'complete_stage', field: 'summary', fixed: { outcome: 'awaiting_approval' } },
  'need-human': { tool: 'complete_stage', field: 'summary', fixed: { outcome: 'needs_human' } },
};

/** @returns {{ tool: string, params: object } | { error: string }} */
export function parseCli(argv, readText = () => { throw new Error('no reader'); }) {
  const [first, ...rest] = argv;
  if (!first) return { error: 'perintah kosong' };

  const sh = SHORTHANDS[first];
  if (sh) {
    const tf = rest.indexOf('--text-file');
    let text;
    if (tf !== -1) {
      if (!rest[tf + 1]) return { error: '--text-file butuh path' };
      try { text = readText(rest[tf + 1]); } catch (e) { return { error: `tidak bisa membaca ${rest[tf + 1]}: ${e.message}` }; }
    } else {
      text = rest.join(' ');
    }
    text = String(text ?? '').replace(/^﻿/, '').trim();
    if (!text) return { error: `${first}: teks kosong. Contoh: ${first} "isi teks"` };
    return { tool: sh.tool, params: { ...(sh.fixed ?? {}), [sh.field]: text } };
  }

  const fi = rest.indexOf('--file');
  try {
    const src = fi !== -1 ? readText(rest[fi + 1]) : (rest[0] ?? '{}');
    const params = JSON.parse(String(src).replace(/^﻿/, ''));
    if (!params || typeof params !== 'object' || Array.isArray(params)) return { error: 'parameter harus objek JSON' };
    return { tool: first, params };
  } catch (e) {
    return { error: `parameter bukan JSON valid: ${e.message}. Tip: pakai perintah pendek tanpa JSON, mis. say "teks" atau done "ringkasan"` };
  }
}
