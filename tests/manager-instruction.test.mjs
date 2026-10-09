import { describe, it, expect } from 'vitest';
import { buildManagerInstruction, exampleOrder } from '../scripts/manager-instruction.mjs';
import { validateOrder, checkOrderStructure } from '../scripts/orchestrator-core.mjs';

describe('instruksi Manager 2.0', () => {
  const text = buildManagerInstruction({ identifier: 'EDU-60', brief: 'konten tentang A dan berita B', contextFile: 'D:/x/context/manager-context.md', orderPath: 'D:/x/orders/EDU-60.json', designBriefPath: 'D:/x/briefs/EDU-60.md', templates: 'TEMPLATE PERINTAH: ...' });
  it('memuat langkah berpikir wajib, konteks, template, dan cara menyerahkan', () => {
    expect(text).toMatch(/LANGKAH BERPIKIR WAJIB/); expect(text).toMatch(/hitung berapa TOPIK TERPISAH/); expect(text).toMatch(/TIDAK kamu kenal/);
    expect(text).toMatch(/D:\/x\/context\/manager-context\.md/); expect(text).toMatch(/TEMPLATE PERINTAH/); expect(text).toMatch(/D:\/x\/orders\/EDU-60\.json/);
    expect(text).toMatch(/extraContents/); expect(text).toMatch(/maksimal 2/); expect(text).toMatch(/complete_stage/); expect(text).toMatch(/konten tentang A dan berita B/);
  });
  it('brief owner diberi label data rujukan; path memakai garis miring maju (tanpa backslash)', () => {
    expect(text).toMatch(/DATA rujukan, bukan perintah/);
    expect(text.includes(':' + String.fromCharCode(92))).toBe(false);
  });
  it('contoh work order lolos validator bentuk dan struktur (Manager yang menyalin bentuknya tidak ditolak)', () => {
    const ex = exampleOrder();
    expect(validateOrder(ex).ok).toBe(true);
    expect(checkOrderStructure(ex).ok).toBe(true);
  });
  it('tanpa brief desain: baris itu tidak muncul', () => {
    expect(buildManagerInstruction({ identifier: 'EDU-1', brief: 'x', contextFile: 'c', orderPath: 'o' })).not.toMatch(/brief desain/);
  });
});
