// Routing QA dan penghitung putaran (F1.9b, AC1.4). Generik; tanpa I/O kecuali lewat `deps`.
//
// Aturan: gagal teks -> copywriter, gagal desain/visual -> designer, maksimal MAX_ROUNDS putaran per jalur.
// Kegagalan ke-(MAX_ROUNDS+1) pada jalur yang sama -> needs_human, bukan diloloskan.
// Bila teks dan desain sama-sama gagal, teks diperbaiki lebih dulu (desain bergantung pada teks);
// hitungan putaran jalur desain TIDAK bertambah pada putaran itu.

export const MAX_ROUNDS = 2;
export const EMPTY_ROUNDS = Object.freeze({ text: 0, design: 0 });

/**
 * @param {{text:number, design:number}} rounds   putaran perbaikan yang sudah terpakai
 * @param {{failedText:boolean, failedDesign:boolean}} verdict
 * @returns {{action:'pass'|'return_to_copywriter'|'return_to_designer'|'needs_human', rounds:{text:number,design:number}, reason:string}}
 */
export function decide(rounds, verdict, maxRounds = MAX_ROUNDS) {
  const r = { text: rounds?.text ?? 0, design: rounds?.design ?? 0 };
  if (!verdict.failedText && !verdict.failedDesign) {
    return { action: 'pass', rounds: r, reason: 'semua cek lolos' };
  }
  if (verdict.failedText) {
    if (r.text >= maxRounds) {
      return { action: 'needs_human', rounds: r, reason: `teks masih gagal setelah ${maxRounds} putaran perbaikan` };
    }
    return { action: 'return_to_copywriter', rounds: { ...r, text: r.text + 1 }, reason: `gagal teks (putaran ${r.text + 1} dari ${maxRounds})` };
  }
  if (r.design >= maxRounds) {
    return { action: 'needs_human', rounds: r, reason: `desain/visual masih gagal setelah ${maxRounds} putaran perbaikan` };
  }
  return { action: 'return_to_designer', rounds: { ...r, design: r.design + 1 }, reason: `gagal desain/visual (putaran ${r.design + 1} dari ${maxRounds})` };
}

/** Gabungkan hasil deterministik (kode) dan penilaian LLM. LLM hanya bisa MENAMBAH kegagalan, tidak bisa meloloskan. */
export function combineVerdict(deterministic, llm) {
  return {
    failedText: deterministic.summary.failedText || llm?.textOk === false,
    failedDesign: deterministic.summary.failedDesign || deterministic.summary.failedVisual || llm?.designOk === false,
  };
}
