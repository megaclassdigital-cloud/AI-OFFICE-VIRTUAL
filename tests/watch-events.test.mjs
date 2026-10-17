import { describe, it, expect } from 'vitest';
import { evaluate } from '../scripts/watch-events.mjs';

const MIN = 60_000; const T0 = 1_800_000_000_000;
const ok = { overall: 'ok', summary: 'Semua terhubung', memoryFreeMB: 900 };
const base = (over = {}) => ({ launcher: ok, orch: { job: { identifier: 'EDU-1', stageIndex: 2, phase: 'running' }, history: [] }, ledger: [], autoLog: [], breaker: null, logLines: ['a', 'b'], ...over });
const run = (steps) => { let st = {}; const out = []; for (const [t, snap] of steps) { const r = evaluate(st, snap, T0 + t * MIN); st = r.next; out.push(r.events); } return out; };

describe('pemantau picu-tepi (hemat token)', () => {
  it('keadaan awal tidak memicu apa pun dan keadaan stabil tetap diam', () => {
    const o = run([[0, base()], [1, base()], [2, base()]]);
    expect(o.flat()).toEqual([]);
  });
  it('STACK: baru memicu setelah >3 menit bermasalah, sekali, lalu satu kabar pulih', () => {
    const bad = base({ launcher: { overall: 'sebagian', summary: 'Sebagian bermasalah: Paperclip', memoryFreeMB: 900 } });
    const o = run([[0, base()], [1, bad], [3, bad], [5, bad], [6, bad], [7, base()]]);
    expect(o[2]).toEqual([]); // belum 3 menit
    expect(o[3].join()).toMatch(/STACK bermasalah/); expect(o[4]).toEqual([]);
    expect(o[5].join()).toMatch(/STACK pulih/);
  });
  it('RAM: butuh 3 cuplikan berturut-turut rendah; pulih memberi kabar', () => {
    const low = base({ launcher: { ...ok, memoryFreeMB: 300 } });
    const o = run([[0, base()], [1, low], [2, low], [3, low], [4, low], [5, base({ launcher: { ...ok, memoryFreeMB: 800 } })]]);
    expect(o[1]).toEqual([]); expect(o[2]).toEqual([]); expect(o[3].join()).toMatch(/RAM menipis/); expect(o[4]).toEqual([]); expect(o[5].join()).toMatch(/RAM pulih/);
  });
  it('JOB: selesai dan terblokir dilaporkan sekali; pergantian tahap dilaporkan', () => {
    const s1 = base(); const s2 = base({ orch: { job: { identifier: 'EDU-1', stageIndex: 3, phase: 'running' }, history: [] } });
    const s3 = base({ orch: { job: null, history: [{ identifier: 'EDU-1', phase: 'done' }] } });
    const s4 = base({ orch: { job: null, history: [{ identifier: 'EDU-1', phase: 'done' }, { identifier: 'EDU-2', phase: 'blocked', blockReason: 'Process lost' }] } });
    const o = run([[0, s1], [1, s2], [2, s3], [3, s3], [4, s4]]);
    expect(o[1].join()).toMatch(/tahap 3/); expect(o[2].join()).toMatch(/EDU-1 SELESAI/); expect(o[3]).toEqual([]); expect(o[4].join()).toMatch(/EDU-2 TERBLOKIR: Process lost/);
  });
  it('JOB macet >40 menit pada tahap yang sama dilaporkan sekali', () => {
    const o = run([[0, base()], [20, base()], [41, base()], [60, base()]]);
    expect(o[2].join()).toMatch(/>40 mnt/); expect(o[3]).toEqual([]);
  });
  it('POST dan OTONOM: entri baru dilaporkan; yang lama tidak', () => {
    const o = run([[0, base({ ledger: [{ mode: 'live', content: 'EDU-97', platform: 'instagram', status: 'diposting' }] })],
      [1, base({ ledger: [{ mode: 'live', content: 'EDU-97', platform: 'instagram', status: 'diposting' }, { mode: 'live', content: 'EDU-97', platform: 'tiktok', status: 'gagal', error: 'x' }], autoLog: [{ file: 'auto-1.md' }] })]]);
    expect(o[0]).toEqual([]); expect(o[1].join('|')).toMatch(/POST EDU-97 → tiktok: gagal/); expect(o[1].join('|')).toMatch(/OTONOM brief otomatis baru/);
  });
  it('GALAT: hanya baris baru yang relevan; baris biasa diam; pembatas laju 5 menit', () => {
    const l = ['x', 'y'];
    const o = run([[0, base({ logLines: l })], [1, base({ logLines: [...l, 'biasa saja'] })], [2, base({ logLines: [...l, 'biasa saja', '2026 EDU-9 DIBLOKIR: tahap QA'] })], [3, base({ logLines: [...l, 'biasa saja', '2026 EDU-9 DIBLOKIR: tahap QA', '2026 EDU-9 DIBLOKIR: tahap QA'] })]]);
    expect(o[1]).toEqual([]); expect(o[2].join()).toMatch(/GALAT .*DIBLOKIR/); expect(o[3]).toEqual([]);
  });
});
