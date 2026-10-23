import { describe, it, expect } from 'vitest';
import { escapeControlForDoc } from '../scripts/finalize-production.mjs';

describe('escapeControlForDoc: JSON tahan perubahan escape oleh dokumen markdown Paperclip', () => {
  it('baris baru/tab/CR di dalam string ditulis \\uXXXX; nilai setelah parse tidak berubah', () => {
    const obj = { caption: 'Baris satu!\n\n#Tag1 #Tag2', tab: 'a\tb', cr: 'x\r\ny', plain: 'tanpa kontrol', quote: 'dia berkata "halo"', slash: 'C:\\jalur\\n' };
    const enc = escapeControlForDoc(JSON.stringify(obj));
    const { slash, ...tanpaSlash } = obj; void slash;
    expect(escapeControlForDoc(JSON.stringify(tanpaSlash))).not.toMatch(/\\n|\\r|\\t/); // tidak ada escape yang bisa diubah menjadi karakter kontrol
    expect(JSON.parse(enc).caption).toBe(obj.caption); expect(JSON.parse(enc).tab).toBe(obj.tab); expect(JSON.parse(enc).cr).toBe(obj.cr);
    expect(JSON.parse(enc).plain).toBe(obj.plain); expect(JSON.parse(enc).quote).toBe(obj.quote);
    expect(JSON.parse(enc).slash).toBe(obj.slash); // garis miring terbalik + n literal tidak boleh jadi baris baru
  });
  it('teks tanpa escape tidak berubah', () => { const t = JSON.stringify({ a: 1, b: ['x', 'y'] }); expect(escapeControlForDoc(t)).toBe(t); });
});
