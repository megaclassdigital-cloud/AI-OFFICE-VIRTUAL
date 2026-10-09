// netcheck.mjs — internet connectivity sentinel (no OS triggers, no daemon of its own: the orchestrator loop calls it).
// Pure decision logic is separate from the probe so it can be tested without a network.
// Safety rules: a probe that THROWS is treated as "unknown" (never blocks work); any HTTP response counts as reachable.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const TARGETS = Object.freeze([
  'https://www.gstatic.com/generate_204',
  'https://generativelanguage.googleapis.com/',
  'https://api.openai.com/',
]);
export const OFFLINE_AFTER = 2; // consecutive failed probes before we ANNOUNCE offline (holding work starts at the first failure)
export const ONLINE_AFTER = 2; // consecutive good probes before we ANNOUNCE recovery

/** Probe: reachable when at least one target answers with any HTTP status within the timeout. */
export async function probe({ targets = TARGETS, timeoutMs = 5000, fetchFn = fetch } = {}) {
  const results = await Promise.all(targets.map(async (url) => {
    try { const r = await fetchFn(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' }); return { url, ok: r.status > 0 }; }
    catch (e) { return { url, ok: false, error: String(e?.cause?.code ?? e?.message ?? e).slice(0, 60) }; }
  }));
  return { reachable: results.some((r) => r.ok), results };
}

/**
 * State machine. state: { online, announcedOffline, since, failures, successes } ; returns { state, events }
 *  - `hold` is true from the FIRST failed probe (waiting is cheap and safe).
 *  - events: 'offline' after OFFLINE_AFTER failures, 'online' after ONLINE_AFTER good probes following an announced outage.
 */
export function decide(prev, reachable, nowMs) {
  const s = { online: true, announcedOffline: false, since: null, failures: 0, successes: 0, ...prev };
  const events = [];
  if (reachable) {
    s.successes += 1; s.failures = 0;
    if (!s.online && s.successes >= ONLINE_AFTER) {
      if (s.announcedOffline) events.push({ type: 'online', downMs: nowMs - (s.since ?? nowMs) });
      s.online = true; s.announcedOffline = false; s.since = null;
    } else if (s.online) { s.since = null; }
  } else {
    s.failures += 1; s.successes = 0;
    if (s.online) { s.online = false; s.since = nowMs; }
    if (!s.announcedOffline && s.failures >= OFFLINE_AFTER) { s.announcedOffline = true; events.push({ type: 'offline', since: s.since }); }
  }
  s.hold = !s.online;
  s.updatedAtMs = nowMs;
  return { state: s, events };
}

/** Atomic write (temp + rename) so readers (UI, failover) never see a half-written file. */
export function writeNetworkState(file, state) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, file);
}

export function readNetworkState(file) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) : null; } catch { return null; }
}

/** True only when the state file says we are offline AND it is fresh (stale file => do not hold work forever). */
export function isOffline(state, nowMs = Date.now(), maxAgeMs = 120_000) {
  return !!state && state.hold === true && nowMs - (state.updatedAtMs ?? 0) < maxAgeMs;
}

/** Network-type error text (the agent's request itself could not reach the provider). */
export const isNetworkError = (text) => /cannot connect to api|unable to connect|socket connection was closed|econnreset|enotfound|etimedout|eai_again|fetch failed|getaddrinfo|network|typo in the url|connection (was )?(refused|reset)/i.test(String(text ?? ''));
