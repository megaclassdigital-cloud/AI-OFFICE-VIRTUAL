// instagram.mjs — alur DRY-RUN unggah carousel ke Instagram web (ADR-0005). Mengisi dialog "New post" sampai kolom caption terisi, lalu BERHENTI
// sebelum tombol Share dan membuang draf. Tidak berimprovisasi: tiap langkah punya pra-syarat yang diperiksa; bila tidak cocok, berhenti dan melapor.
// Semua klik melewati assertClickAllowed: tombol final (Share/Post/Bagikan/...) DITOLAK dalam dry-run (galat fatal, bukan peringatan).
// Tangkapan layar hanya ELEMEN DIALOG (bukan beranda owner). Antarmuka diverifikasi 16 Okt 2026 (bahasa Inggris, akun Professional).
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { assertClickAllowed } from './guards.mjs';

export class StepError extends Error { constructor(step, message) { super(`${step}: ${message}`); this.step = step; } }

const DIALOG = 'div[role=dialog]';

/** Alur dry-run. page = halaman Instagram yang sudah login; pkg = paket tervalidasi (package.mjs). Mengembalikan ringkasan; melempar StepError bila gagal. */
export async function dryRunInstagram({ page, pkg, evidenceDir, log = () => {} }) {
  mkdirSync(evidenceDir, { recursive: true });
  const dryRun = true;
  let step = 'awal';
  const click = async (loc, label) => { assertClickAllowed(label, { dryRun }); log(`klik: ${label}`); await loc.first().click({ timeout: 15000 }); };
  const dialogButtons = () => page.evaluate((sel) => [...document.querySelectorAll(`${sel} button, ${sel} [role=button]`)].map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\s+/g, ' ')).filter(Boolean), DIALOG);
  const shot = async (name) => { const d = page.locator(DIALOG).last(); if (await d.count()) await d.screenshot({ path: path.join(evidenceDir, `${name}.png`) }).catch(() => {}); };
  const needButton = async (re, what, ms = 15000) => { const b = page.locator(DIALOG).getByRole('button', { name: re }); try { await b.first().waitFor({ state: 'visible', timeout: ms }); } catch { throw new StepError(step, `tombol "${what}" tidak muncul (dialog berisi: ${(await dialogButtons()).slice(0, 8).join(' | ') || 'kosong'})`); } return b; };
  try {
    step = 'halaman';
    await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(3500);
    if (/\/accounts\/login|\/challenge/.test(page.url())) throw new StepError(step, `Instagram meminta login/verifikasi ulang (${page.url().replace(/\?.*/, '')}); jalankan social-login.mjs`);
    for (const re of [/^Not Now$/i]) { const b = page.getByRole('button', { name: re }); if (await b.count()) await click(b, 'Not Now'); } // pop-up notifikasi

    step = 'buka New post';
    const icon = page.locator('svg[aria-label="New post"]');
    if (!(await icon.count())) throw new StepError(step, 'ikon "New post" tidak ada di sidebar (akun belum Professional/antarmuka berubah)');
    await click(icon, 'New post'); await page.waitForTimeout(1500);
    step = 'pilih Post';
    const postItem = page.getByRole('link', { name: /^Post$/ }).or(page.getByRole('menuitem', { name: /^Post$/ })).or(page.locator('a:has(svg[aria-label="Post"])'));
    if (await postItem.count()) await click(postItem, 'Post (menu)');
    await page.waitForTimeout(2000);

    step = 'unggah slide';
    const chooserP = page.waitForEvent('filechooser', { timeout: 15000 });
    await click(page.locator(DIALOG).getByRole('button', { name: /Select from computer/i }), 'Select from computer');
    const chooser = await chooserP;
    await chooser.setFiles(pkg.slides.map((s) => s.path));
    await needButton(/^Next$/i, 'Next (setelah unggah)', 30000);
    await shot('01-setelah-unggah');

    // Instagram web memotong ke 1:1 secara bawaan (menghilangkan bagian bawah slide 4:5, termasuk footer). Pilih "Original" supaya slide tampil UTUH.
    step = 'crop Original';
    const cropBtn = page.locator(`${DIALOG} svg[aria-label="Select crop"]`);
    if (!(await cropBtn.count())) throw new StepError(step, 'tombol "Select crop" tidak ada (antarmuka berubah)');
    await click(cropBtn, 'Select crop'); await page.waitForTimeout(800);
    const original = page.locator(DIALOG).getByText(/^Original$/);
    if (!(await original.count())) throw new StepError(step, `pilihan "Original" tidak ada pada menu crop`);
    await click(original, 'Original'); await page.waitForTimeout(1500);
    await shot('01b-crop-original');

    step = 'Next (potong)';
    await click(await needButton(/^Next$/i, 'Next'), 'Next'); await page.waitForTimeout(2000);
    step = 'Next (filter)';
    await click(await needButton(/^Next$/i, 'Next'), 'Next'); await page.waitForTimeout(2000);
    await needButton(/^Share$/i, 'Share (hanya diperiksa ADA, tidak diklik)'); // pra-syarat: sudah di langkah caption
    await shot('02-langkah-caption');

    step = 'isi caption';
    const cap = page.locator(`${DIALOG} [role=textbox], ${DIALOG} textarea, ${DIALOG} [contenteditable=true]`).first();
    if (!(await cap.count())) throw new StepError(step, 'kolom caption tidak ditemukan');
    await cap.click(); await page.keyboard.insertText(pkg.captionFull); await page.waitForTimeout(1200);
    const typed = (await cap.innerText().catch(() => '')).replace(/\s+/g, ' ');
    const head = pkg.captionFull.replace(/\s+/g, ' ').slice(0, 40);
    if (!typed.includes(head)) throw new StepError(step, 'caption yang terisi tidak cocok dengan paket');
    await shot('03-caption-terisi');
    return { ok: true, stoppedBefore: 'Share', slides: pkg.slides.length, captionChars: pkg.captionFull.length, evidenceDir };
  } catch (e) {
    await shot('galat').catch(() => {});
    throw e instanceof StepError ? e : new StepError(step, String(e.message).split('\n')[0].slice(0, 240));
  } finally {
    // buang draf: Escape lalu Discard (dry-run tidak boleh meninggalkan draf di akun)
    try {
      await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
      const discard = page.getByRole('button', { name: /^Discard$/i });
      if (await discard.count()) { await click(discard, 'Discard'); log('draf dibuang'); }
    } catch (e) { log(`peringatan: gagal membuang draf (${String(e.message).slice(0, 80)})`); }
  }
}
