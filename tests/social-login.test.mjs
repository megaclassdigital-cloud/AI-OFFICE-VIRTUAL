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
