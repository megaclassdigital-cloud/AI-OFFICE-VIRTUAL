// Menyambungkan guard pemakaian (usage-guard.js) ke event run Paperclip.
//
// Dipicu setiap run dimulai/selesai/gagal. Daftar run diambil dari API host (riwayat run nyata, bukan
// payload event) sehingga hitungan tidak bergantung pada bentuk payload. Lokasi file batas:
// config plugin `limitsFile`, lalu env AAO_LIMITS_FILE, lalu default bawaan (6 run / 60 menit).

import { readFileSync } from 'node:fs';
import { enforce, DEFAULT_LIMITS } from './usage-guard.js';

const EVENTS = ['agent.run.started', 'agent.run.finished', 'agent.run.failed', 'agent.run.cancelled'];

export function readLimits(path) {
  if (!path) return { ...DEFAULT_LIMITS };
  return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
}

export function registerUsageGuard(ctx, { apiBase = process.env.AAO_API_BASE ?? 'http://127.0.0.1:3177' } = {}) {
  const busy = new Set(); // satu pemeriksaan per company pada satu waktu

  async function check(companyId) {
    if (busy.has(companyId)) return null;
    busy.add(companyId);
    try {
      const cfg = (await ctx.config.get(companyId).catch(() => ({}))) ?? {};
      const limitsRaw = readLimits(cfg.limitsFile ?? process.env.AAO_LIMITS_FILE);
      return await enforce({
        companyId,
        limitsRaw,
        deps: {
          listRuns: async (co) => {
            const r = await fetch(`${apiBase}/api/companies/${co}/heartbeat-runs?limit=500`);
            if (!r.ok) throw new Error(`heartbeat-runs HTTP ${r.status}`);
            return await r.json();
          },
          getAgent: (id, co) => ctx.agents.get(id, co),
          pauseAgent: (id, co) => ctx.agents.pause(id, co),
          audit: (entry) => ctx.activity.log(entry),
        },
      });
    } catch (e) {
      // Guard gagal terbuka = bahaya (tak ada batas), jadi galat harus terlihat di log.
      ctx.logger.error('usage guard gagal', { companyId, error: String(e?.message ?? e) });
      return null;
    } finally {
      busy.delete(companyId);
    }
  }

  for (const name of EVENTS) {
    ctx.events.on(name, async (event) => {
      if (event.companyId) await check(event.companyId);
    });
  }
  return { check };
}
