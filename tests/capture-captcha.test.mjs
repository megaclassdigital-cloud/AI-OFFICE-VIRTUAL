import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CAPTCHA, surfaceCaptcha } from '../scripts/capture-asset.mjs';

const mkPage = () => { const calls = []; return { calls, bringToFront: async () => calls.push('front'), context: () => ({ newCDPSession: async () => ({ send: async (m, a) => { calls.push(m + (a?.bounds ? ':' + a.bounds.left : '')); return { windowId: 1 }; }, detach: async () => {} }) }) }; };
const noSleep = async () => {};

describe('CAPTCHA Google: jendela dimunculkan untuk owner (alternatif), tidak pernah dilewati kode', () => {
  beforeEach(() => { const d = mkdtempSync(path.join(tmpdir(), 'cap-')); CAPTCHA.file = path.join(d, 'c.json'); CAPTCHA.enabled = true; CAPTCHA.waitMs = 20_000; return () => { rmSync(d, { recursive: true, force: true }); CAPTCHA.enabled = false; }; });

  it('mati (cadangan Playwright/headless): tidak menyentuh jendela sama sekali', async () => {
    CAPTCHA.enabled = false; const p = mkPage(); const notes = [];
    expect(await surfaceCaptcha(p, { sleep: noSleep, blocked: async () => true, notify: (...a) => notes.push(a) })).toBe(false);
    expect(p.calls).toHaveLength(0); expect(notes).toHaveLength(0);
  });
  it('owner menyelesaikan: jendela muncul, owner diberi tahu, lanjut (true), lalu jendela disembunyikan lagi', async () => {
    const p = mkPage(); const notes = []; let n = 0;
    const ok = await surfaceCaptcha(p, { sleep: noSleep, blocked: async () => ++n < 3, notify: (...a) => notes.push(a) });
    expect(ok).toBe(true); expect(notes).toHaveLength(1); expect(notes[0][1]).toMatch(/CAPTCHA/);
    expect(p.calls).toContain('front'); expect(p.calls.filter((c) => c.startsWith('Browser.setWindowBounds'))).toEqual(['Browser.setWindowBounds:80', 'Browser.setWindowBounds:-32000']);
  });
  it('owner tidak menyelesaikan sampai batas waktu: false (perilaku lama berlaku) dan jendela tetap disembunyikan lagi', async () => {
    const p = mkPage(); CAPTCHA.waitMs = 5;
    expect(await surfaceCaptcha(p, { sleep: async () => { await new Promise((r) => setTimeout(r, 8)); }, blocked: async () => true, notify: () => {} })).toBe(false);
    expect(p.calls.filter((c) => c.startsWith('Browser.setWindowBounds')).pop()).toBe('Browser.setWindowBounds:-32000');
  });
  it('cooldown 30 menit: permintaan kedua tidak memunculkan jendela lagi (owner mungkin tidak ada)', async () => {
    const p1 = mkPage(); await surfaceCaptcha(p1, { sleep: noSleep, blocked: async () => false, notify: () => {} });
    const p2 = mkPage(); const notes = [];
    expect(await surfaceCaptcha(p2, { sleep: noSleep, blocked: async () => false, notify: (...a) => notes.push(a) })).toBe(false);
    expect(p2.calls).toHaveLength(0); expect(notes).toHaveLength(0); expect(existsSync(CAPTCHA.file)).toBe(true);
  });
});
