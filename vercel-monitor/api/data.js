// /api/* (disajikan lewat rewrite ke sini dengan ?r=<rute>): menyajikan dokumen yang sudah didorong laptop, dalam bentuk yang sama dengan server Office View desktop.
// Hanya GET. Perintah (chat Manager, tombol keputusan) tidak ada di sini: info owner/talk selalu "nonaktif".
// HEMAT KUOTA Blob: dokumen panas (snapshot/events/network/autopost/autonomy/meta) dibaca dari SATU dokumen `doc/hot`, dokumen lain dari memori instance (TTL) sebelum menyentuh Blob.
import { getStore, cachedJson, markViewer, parseSession, send, COOKIE } from './_lib.js';

void COOKIE;
const AGENTS = new Set(['manager', 'researcher', 'verifier', 'copywriter', 'designer', 'qa']);
const IMAGE_OK = /^runs\/[A-Za-z0-9_-]+(?:\/revision-[0-9]+)?\/render\/[A-Za-z0-9._-]+\.png$/;
const PROD_RE = /^EDU-[0-9]+$/;
const HOT_TTL = 10_000; const WARM_TTL = 60_000; const COLD_TTL = 5 * 60_000;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'monitor hanya-baca' });
  if (!parseSession(req.headers.cookie, process.env.MIRROR_SESSION_SECRET)) return send(res, 401, { error: 'butuh tautan monitor' });
  const url = new URL(req.url, 'http://x');
  const route = '/' + String(url.searchParams.get('r') ?? '').replace(/^\/+/, '');
  const q = (k) => url.searchParams.get(k) ?? '';
  const store = getStore();
  markViewer(); // laptop membaca sinyal ini lewat /api/ingest?demand=1
  const doc = (key, ttl = WARM_TTL) => cachedJson(store, key, ttl);
  // bagian dokumen panas; dokumen lama terpisah (doc/<nama>) hanya sebagai cadangan masa transisi
  const hot = async (part) => { const h = await doc('doc/hot', HOT_TTL); if (h?.[part] != null) return h[part]; return part === 'meta' ? null : doc('doc/' + part, HOT_TTL); };
  const meta = async () => (await hot('meta')) ?? (await doc('doc/meta', HOT_TTL));
  const notYet = () => send(res, 404, { error: 'belum ada data (laptop belum mengirim)' });

  try {
    if (route === '/access/whoami') return send(res, 200, { role: 'review', readOnly: true, mirror: true });
    if (route === '/talk/info' || route === '/owner/info') return send(res, 200, { enabled: false });
    if (route === '/mirror/meta') { const m = await meta(); return m ? send(res, 200, m) : notYet(); }
    if (route === '/layout') { const d = await doc('doc/layout', COLD_TTL); return d ? send(res, 200, d) : notYet(); }
    if (route === '/network') return send(res, 200, (await hot('network')) ?? { offline: false, known: false });
    if (route === '/status') { const m = await meta(); return send(res, 200, { connected: !!m, lastOkAt: m?.publishedAt ?? null }); }
    if (route === '/snapshot') { const d = await hot('snapshot'); return d ? send(res, 200, d) : notYet(); }
    if (route === '/replay') { const d = await doc('doc/replay', COLD_TTL); return d ? send(res, 200, d) : notYet(); }
    if (route === '/events') {
      const d = await hot('events'); if (!d) return notYet();
      const since = Number(q('since')) || 0;
      return send(res, 200, { epoch: d.epoch, seq: d.seq, connected: d.connected, error: null, events: (d.events ?? []).filter((e) => e.seq > since) });
    }
    if (route === '/inspect/board') {
      const limit = Math.min(50, Math.max(0, parseInt(q('limit'), 10) || 0));
      const d = await doc('doc/board');
      if (!d) return notYet();
      return send(res, 200, limit ? { ...d, items: (d.items ?? []).slice(0, limit) } : d);
    }
    if (route === '/inspect/production') {
      const prod = q('prod'); const rev = q('rev');
      if (!PROD_RE.test(prod) || (rev !== '' && !/^[0-9]{1,3}$/.test(rev))) return send(res, 400, { error: 'id produksi tidak valid' });
      const d = await doc(rev !== '' && rev !== '0' ? `doc/prod/${prod}/r${rev}` : `doc/prod/${prod}`);
      return d ? send(res, 200, d) : send(res, 404, { error: 'konten ini belum disalin ke monitor' });
    }
    if (route === '/inspect/agent') {
      const name = q('name').toLowerCase();
      if (!AGENTS.has(name)) return send(res, 400, { error: 'agen tidak dikenal' });
      const all = await doc('doc/agents');
      const d = all?.[name] ?? (await doc(`doc/agent/${name}`)); return d ? send(res, 200, d) : notYet();
    }
    if (route === '/inspect/approvals') { const d = await doc('doc/approvals'); return d ? send(res, 200, d) : notYet(); }
    if (route === '/inspect/autopost') { const d = await hot('autopost'); return d ? send(res, 200, d) : notYet(); }
    if (route === '/inspect/autonomy') { const d = await hot('autonomy'); return d ? send(res, 200, d) : notYet(); }
    if (route === '/inspect/image') {
      const p = q('path').replaceAll('\\', '/');
      if (!IMAGE_OK.test(p)) return send(res, 403, { error: 'gambar tidak tersedia' });
      const r = await store.get('img/' + p);
      if (!r) return send(res, 404, { error: 'gambar belum disalin' });
      return send(res, 200, r.buf, 'image/png', { 'cache-control': 'private, max-age=86400', ...(q('download') === '1' ? { 'content-disposition': `attachment; filename="${p.split('/').pop()}"` } : {}) });
    }
    return send(res, 404, { error: 'rute tidak tersedia di monitor' });
  } catch (e) {
    return send(res, 502, { error: 'penyimpanan tidak terbaca: ' + String(e.message).slice(0, 100) });
  }
}
