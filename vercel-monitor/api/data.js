// /api/* (disajikan lewat rewrite ke sini dengan ?r=<rute>): menyajikan dokumen yang sudah didorong laptop, dalam bentuk yang sama dengan server Office View desktop.
// Hanya GET. Perintah (chat Manager, tombol keputusan) tidak ada di sini: info owner/talk selalu "nonaktif".
import { getStore, getJson, parseSession, send, COOKIE } from './_lib.js';

void COOKIE;
const AGENTS = new Set(['manager', 'researcher', 'verifier', 'copywriter', 'designer', 'qa']);
const IMAGE_OK = /^runs\/[A-Za-z0-9_-]+(?:\/revision-[0-9]+)?\/render\/[A-Za-z0-9._-]+\.png$/;
const PROD_RE = /^EDU-[0-9]+$/;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'monitor hanya-baca' });
  if (!parseSession(req.headers.cookie, process.env.MIRROR_SESSION_SECRET)) return send(res, 401, { error: 'butuh tautan monitor' });
  const url = new URL(req.url, 'http://x');
  const route = '/' + String(url.searchParams.get('r') ?? '').replace(/^\/+/, '');
  const q = (k) => url.searchParams.get(k) ?? '';
  const store = getStore();
  const doc = async (key) => (await getJson(store, key));
  const notYet = () => send(res, 404, { error: 'belum ada data (laptop belum mengirim)' });

  try {
    if (route === '/access/whoami') return send(res, 200, { role: 'review', readOnly: true, mirror: true });
    if (route === '/talk/info' || route === '/owner/info') return send(res, 200, { enabled: false });
    if (route === '/mirror/meta') { const m = await doc('doc/meta'); return m ? send(res, 200, m) : notYet(); }
    if (route === '/layout') { const d = await doc('doc/layout'); return d ? send(res, 200, d) : notYet(); }
    if (route === '/network') return send(res, 200, (await doc('doc/network')) ?? { offline: false, known: false });
    if (route === '/status') { const m = await doc('doc/meta'); return send(res, 200, { connected: !!m, lastOkAt: m?.publishedAt ?? null }); }
    if (route === '/snapshot') { const d = await doc('doc/snapshot'); return d ? send(res, 200, d) : notYet(); }
    if (route === '/replay') { const d = await doc('doc/replay'); return d ? send(res, 200, d) : notYet(); }
    if (route === '/events') {
      const d = await doc('doc/events'); if (!d) return notYet();
      const since = Number(q('since')) || 0;
      return send(res, 200, { epoch: d.epoch, seq: d.seq, connected: d.connected, error: null, events: (d.events ?? []).filter((e) => e.seq > since) });
    }
    if (route === '/inspect/board') {
      const limit = Math.min(50, Math.max(0, parseInt(q('limit'), 10) || 0));
      const d = limit ? ((await doc('doc/board3')) ?? (await doc('doc/board'))) : await doc('doc/board');
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
      const d = await doc(`doc/agent/${name}`); return d ? send(res, 200, d) : notYet();
    }
    if (route === '/inspect/approvals') { const d = await doc('doc/approvals'); return d ? send(res, 200, d) : notYet(); }
    if (route === '/inspect/autopost') { const d = await doc('doc/autopost'); return d ? send(res, 200, d) : notYet(); }
    if (route === '/inspect/autonomy') { const d = await doc('doc/autonomy'); return d ? send(res, 200, d) : notYet(); }
    if (route === '/inspect/image') {
      const p = q('path').replaceAll('\\', '/');
      if (!IMAGE_OK.test(p)) return send(res, 403, { error: 'gambar tidak tersedia' });
      const r = await store.get('img/' + p);
      if (!r) return send(res, 404, { error: 'gambar belum disalin' });
      return send(res, 200, r.buf, 'image/png', { 'cache-control': 'private, max-age=300', ...(q('download') === '1' ? { 'content-disposition': `attachment; filename="${p.split('/').pop()}"` } : {}) });
    }
    return send(res, 404, { error: 'rute tidak tersedia di monitor' });
  } catch (e) {
    return send(res, 502, { error: 'penyimpanan tidak terbaca: ' + String(e.message).slice(0, 100) });
  }
}
