import { describe, it, expect } from 'vitest';
import { parseCli } from '../divisions/edukasiai/tools/aao-cli.mjs';

const files = { 'C:/t/body.txt': '\uFEFFBaris satu & dua "kutip" `backtick`\nbaris tiga ≥ ×\n', 'C:/t/p.json': '{"issueId":"i1","body":"x"}' };
const reader = (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; };

describe('perintah pendek tanpa JSON', () => {
  it('say -> post_comment dengan teks apa adanya (spasi digabung)', () => {
    expect(parseCli(['say', 'Status', 'EDU-43:', 'riset', '&', 'verifikasi', 'selesai'])).toEqual({ tool: 'post_comment', params: { body: 'Status EDU-43: riset & verifikasi selesai' } });
  });
  it('done -> complete_stage awaiting_approval; need-human -> needs_human', () => {
    expect(parseCli(['done', 'Selesai 5 slide'])).toEqual({ tool: 'complete_stage', params: { outcome: 'awaiting_approval', summary: 'Selesai 5 slide' } });
    expect(parseCli(['need-human', 'Tool', 'gagal'])).toEqual({ tool: 'complete_stage', params: { outcome: 'needs_human', summary: 'Tool gagal' } });
  });
  it('--text-file membaca UTF-8 apa adanya (BOM dibuang), kutip/backtick/simbol aman', () => {
    const r = parseCli(['say', '--text-file', 'C:/t/body.txt'], reader);
    expect(r.params.body).toBe('Baris satu & dua "kutip" `backtick`\nbaris tiga ≥ ×');
  });
  it('teks kosong dan file tak ada ditolak dengan pesan yang membantu', () => {
    expect(parseCli(['say'])).toMatchObject({ error: expect.stringContaining('teks kosong') });
    expect(parseCli(['done', '--text-file', 'C:/nope.txt'], reader)).toMatchObject({ error: expect.stringContaining('tidak bisa membaca') });
    expect(parseCli(['say', '--text-file'], reader)).toMatchObject({ error: expect.stringContaining('butuh path') });
  });
});

describe('bentuk klasik tetap jalan', () => {
  it('JSON inline dan --file', () => {
    expect(parseCli(['post_comment', '{"issueId":"i1","body":"x"}'])).toEqual({ tool: 'post_comment', params: { issueId: 'i1', body: 'x' } });
    expect(parseCli(['post_comment', '--file', 'C:/t/p.json'], reader).params).toEqual({ issueId: 'i1', body: 'x' });
  });
  it('tanpa argumen kedua = objek kosong; JSON rusak memberi tip perintah pendek', () => {
    expect(parseCli(['aao_hello'])).toEqual({ tool: 'aao_hello', params: {} });
    const bad = parseCli(['post_comment', '{bad']);
    expect(bad.error).toContain('bukan JSON valid'); expect(bad.error).toContain('say "teks"');
    expect(parseCli([])).toMatchObject({ error: expect.any(String) });
  });
});
