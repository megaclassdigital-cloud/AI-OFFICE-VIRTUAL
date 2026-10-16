import { describe, it, expect } from 'vitest';
import { sessionState, PLATFORMS, profileDirFor } from '../scripts/autopost/social-login.mjs';

const NOW = 1_800_000_000;
describe('sessionState (hanya nama cookie dan kedaluwarsa)', () => {
  it('masuk bila cookie sesi platform ada dan belum kedaluwarsa', () => {
    const r = sessionState('instagram', [{ domain: '.instagram.com', name: 'sessionid', expires: NOW + 86400 }, { domain: '.instagram.com', name: 'csrftoken', expires: NOW + 100 }], NOW);
    expect(r.loggedIn).toBe(true); expect(r.expiresAt).toBe(new Date((NOW + 86400) * 1000).toISOString());
    expect(sessionState('tiktok', [{ domain: '.tiktok.com', name: 'sid_tt', expires: -1 }], NOW).loggedIn).toBe(true); // cookie sesi browser
  });
  it('belum masuk: tanpa cookie sesi, domain lain, atau kedaluwarsa', () => {
    expect(sessionState('instagram', [{ domain: '.instagram.com', name: 'csrftoken', expires: NOW + 1 }], NOW)).toMatchObject({ loggedIn: false, reason: 'cookie sesi tidak ada' });
    expect(sessionState('instagram', [{ domain: '.evil.com', name: 'sessionid', expires: NOW + 1 }], NOW).loggedIn).toBe(false);
    expect(sessionState('instagram', [{ domain: '.instagram.com', name: 'sessionid', expires: NOW - 1 }], NOW)).toMatchObject({ loggedIn: false, reason: 'sesi kedaluwarsa' });
    expect(sessionState('youtube', [], NOW).loggedIn).toBe(false);
  });
  it('profil terpisah per platform di dalam workspace (bukan Chrome harian)', () => {
    expect(Object.keys(PLATFORMS).sort()).toEqual(['instagram', 'tiktok']);
    expect(profileDirFor('instagram').split(String.fromCharCode(92)).join('/')).toMatch(/workspace\/browser-profile-social\/instagram$/);
    expect(profileDirFor('tiktok')).not.toBe(profileDirFor('instagram'));
  });
});

import { findChrome, chromeArgs } from '../scripts/autopost/social-login.mjs';
describe('Chrome biasa tanpa penanda otomatisasi', () => {
  it('argumen tidak memuat --enable-automation; headless hanya untuk --check', () => {
    const a = chromeArgs({ dir: 'D:/p', port: 9341, url: 'https://x.test/', headless: false });
    expect(a.some((x) => /enable-automation/.test(x))).toBe(false);
    expect(a).toContain('--user-data-dir=D:/p'); expect(a).toContain('--remote-debugging-port=9341');
    expect(a.some((x) => /headless/.test(x))).toBe(false);
    expect(chromeArgs({ dir: 'D:/p', port: 9341, url: 'https://x.test/', headless: true })).toContain('--headless=new');
  });
  it('findChrome memakai CHROME_PATH lebih dulu, lalu lokasi umum; null bila tidak ada', () => {
    expect(findChrome({ CHROME_PATH: 'X:/chrome.exe' }, (p) => p === 'X:/chrome.exe')).toBe('X:/chrome.exe');
    expect(findChrome({}, () => false)).toBeNull();
  });
});

describe('jendela di luar layar untuk posting otomatis', () => {
  it('offscreen menggeser jendela dan mematikan penghentian render; tidak berlaku untuk headless; tetap tanpa penanda otomatisasi', () => {
    const a = chromeArgs({ dir: 'D:/p', port: 9341, url: 'https://x.test/', headless: false, offscreen: true });
    expect(a).toContain('--window-position=-32000,0'); expect(a).toContain('--disable-backgrounding-occluded-windows');
    expect(a.some((x) => /enable-automation/.test(x))).toBe(false);
    expect(chromeArgs({ dir: 'D:/p', port: 9341, url: 'https://x.test/', headless: true, offscreen: true }).some((x) => /window-position/.test(x))).toBe(false);
    expect(chromeArgs({ dir: 'D:/p', port: 9341, url: 'https://x.test/', headless: false }).some((x) => /window-position/.test(x))).toBe(false);
  });
});
