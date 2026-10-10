// export-review-site.mjs — mengekspor konten terpilih menjadi situs statis HANYA-BACA untuk review klien (di-host Vercel dari folder review-site/).
// Aman karena: (1) hanya run yang disebut eksplisit (--runs), (2) hanya slide PNG, caption, hashtag, sumber (URL), judul — tanpa jalur lokal,
// id issue, memori agent, instruksi Manager, atau log, (3) tidak ada perintah apa pun: situs ini statis.
// Pemakaian: node scripts/export-review-site.mjs --runs EDU-49,EDU-27/revision-1 [--out review-site] [--src workspace/agent/runs]
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUN_KEY_RE = /^[A-Za-z0-9_-]+(\/revision-\d+)?$/;
export const dirNameOf = (key) => key.replace('/', '_');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u ?? '')) ? u : null);

/** Ambil hanya bidang yang aman dari carousel.json. */
export function publicMeta(key, carousel, slideFiles) {
  const sources = (carousel.sources ?? []).map((s) => ({ title: String(s.title ?? s.name ?? '').slice(0, 200), url: safeUrl(s.url) })).filter((s) => s.url);
  return {
    key, topic: String(carousel.topic ?? key).slice(0, 300), angle: String(carousel.angle ?? '').slice(0, 600),
    caption: String(carousel.caption ?? '').slice(0, 4000), hashtags: (carousel.hashtags ?? []).map(String).slice(0, 40),
    sources, slides: slideFiles, exportedAt: new Date().toISOString(),
  };
}

export function renderIndex(items) {
  const cards = items.map((m) => `
  <section class="card" id="${esc(m.key.replace('/', '_'))}">
    <h2>${esc(m.topic)} <small>${esc(m.key)}</small></h2>
    <p class="angle">${esc(m.angle)}</p>
    <div class="slides">${m.slides.map((f, i) => `<a href="data/${esc(dirNameOf(m.key))}/${esc(f)}" target="_blank" rel="noopener"><img loading="lazy" src="data/${esc(dirNameOf(m.key))}/${esc(f)}" alt="Slide ${i + 1}"></a>`).join('')}</div>
    <h3>Caption</h3><pre class="cap">${esc(m.caption)}</pre>
    <p class="tags">${m.hashtags.map(esc).join(' ')}</p>
    ${m.sources.length ? `<h3>Sumber</h3><ul>${m.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a></li>`).join('')}</ul>` : ''}
  </section>`).join('\n');
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Review Konten</title>
<style>
:root{--bg:#f6f7f9;--fg:#14171f;--card:#fff;--mut:#5b6472;--line:#e3e6ec}
@media (prefers-color-scheme:dark){:root{--bg:#0f1218;--fg:#e8ebf1;--card:#171b24;--mut:#9aa3b2;--line:#262c38}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:16px}
h1{font-size:1.4rem}.badge{display:inline-block;background:var(--line);color:var(--mut);padding:2px 10px;border-radius:99px;font-size:.8rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:16px 0}
h2 small{font-weight:400;color:var(--mut);font-size:.8rem}.angle{color:var(--mut)}
.slides{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.slides img{width:100%;border-radius:8px;border:1px solid var(--line)}
.cap{white-space:pre-wrap;font:inherit;background:var(--bg);padding:12px;border-radius:8px}.tags{color:var(--mut)}
</style></head><body><main>
<h1>Review Konten <span class="badge">hanya-baca</span></h1>
${cards || '<p>Belum ada konten untuk direview.</p>'}
</main></body></html>`;
}

export function exportSite({ runs, srcRoot, outDir }) {
  if (!runs.length) throw new Error('Sebutkan konten yang diekspor: --runs EDU-49,EDU-27');
  for (const k of runs) if (!RUN_KEY_RE.test(k)) throw new Error(`Kode konten tidak valid: ${k}`);
  rmSync(path.join(outDir, 'data'), { recursive: true, force: true });
  const items = [];
  for (const key of runs) {
    const dir = path.join(srcRoot, ...key.split('/'));
    const cj = path.join(dir, 'carousel.json');
    const renderDir = path.join(dir, 'render');
    if (!existsSync(cj) || !existsSync(renderDir)) throw new Error(`${key}: carousel.json atau render/ tidak ada`);
    const slideFiles = readdirSync(renderDir).filter((f) => /^slide-\d+\.png$/.test(f)).sort();
    if (!slideFiles.length) throw new Error(`${key}: tidak ada slide-NN.png`);
    const dest = path.join(outDir, 'data', dirNameOf(key));
    mkdirSync(dest, { recursive: true });
    for (const f of slideFiles) copyFileSync(path.join(renderDir, f), path.join(dest, f));
    const meta = publicMeta(key, JSON.parse(readFileSync(cj, 'utf8')), slideFiles);
    writeFileSync(path.join(dest, 'meta.json'), JSON.stringify(meta, null, 2));
    items.push(meta);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'index.html'), renderIndex(items));
  return items;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const items = exportSite({ runs: (arg('--runs', '') || '').split(',').map((s) => s.trim()).filter(Boolean), srcRoot: path.resolve(root, arg('--src', 'workspace/agent/runs')), outDir: path.resolve(root, arg('--out', 'review-site')) });
    console.log(`Diekspor ${items.length} konten ke ${arg('--out', 'review-site')}: ${items.map((i) => i.key).join(', ')}`);
  } catch (e) { console.error(`GAGAL: ${e.message}`); process.exit(1); }
}
