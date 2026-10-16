// instagram.mjs — alur unggah carousel ke Instagram web (ADR-0005). Dry-run dan LIVE memakai langkah persiapan yang SAMA (prepareInstagram):
// New post -> unggah slide -> crop "Original" -> Next x2 -> caption terisi. Beda hanya di akhir: dry-run membuang draf; live menekan Share.
// Tidak berimprovisasi: tiap langkah punya pra-syarat; bila tidak cocok, berhenti dan melapor (StepError). Semua klik melewati assertClickAllowed:
// tombol final (Share/Post/Bagikan/...) DITOLAK dalam dry-run dan tanpa izin eksplisit. Tangkapan layar hanya ELEMEN DIALOG (bukan beranda owner).
// Antarmuka diverifikasi 16 Okt 2026 (bahasa Inggris, akun Professional).
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { assertClickAllowed } from './guards.mjs';

export class StepError extends Error { constructor(step, message) { super(`${step}: ${message}`); this.step = step; } }

const DIALOG = 'div[role=dialog]';
export const SUCCESS_RE = /(your post has been shared|post shared|has been shared)/i;
export const FAILURE_RE = /(couldn.t be shared|could not be shared|something went wrong|try again)/i;

/** Alat bersama: klik berpagar, tombol dialog, tangkapan elemen dialog. */
function makeKit({ page, evidenceDir, dryRun, log }) {
  const click = async (loc, label, { allowFinal = false } = {}) => { assertClickAllowed(label, { dryRun, allowFinal }); log(`klik: ${label}`); await loc.first().click({ timeout: 15000 }); };
  const dialogButtons = () => page.evaluate((sel) => [...document.querySelectorAll(`${sel} button, ${sel} [role=button]`)].map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\s+/g, ' ')).filter(Boolean), DIALOG);
  const shot = async (name) => { const d = page.locator(DIALOG).last(); if (await d.count()) await d.screenshot({ path: path.join(evidenceDir, `${name}.png`) }).catch(() => {}); };
  const needButton = async (step, re, what, ms = 15000) => { const b = page.locator(DIALOG).getByRole('button', { name: re }); try { await b.first().waitFor({ state: 'visible', timeout: ms }); } catch { throw new StepError(step, `tombol "${what}" tidak muncul (dialog berisi: ${(await dialogButtons()).slice(0, 8).join(' | ') || 'kosong'})`); } return b; };
  return { click, shot, needButton, dialogButtons };
}

/**
 * Persiapan: sampai dialog berada di langkah caption dengan caption terisi dan terverifikasi. Mengembalikan alat dan tombol Share (belum diklik).
 * dryRun menentukan pagar klik; persiapan tidak pernah menekan tombol final.
 */
export async function prepareInstagram({ page, pkg, evidenceDir, dryRun, log = () => {} }) {
  mkdirSync(evidenceDir, { recursive: true });
  const kit = makeKit({ page, evidenceDir, dryRun, log });
  const { click, shot, needButton } = kit;
  let step = 'awal';
  const fail = (e) => (e instanceof StepError ? e : new StepError(step, String(e.message).split('\n')[0].slice(0, 240)));
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
    await needButton(step, /^Next$/i, 'Next (setelah unggah)', 30000);
    await shot('01-setelah-unggah');

    // Instagram web memotong ke 1:1 secara bawaan (menghilangkan bagian bawah slide 4:5, termasuk footer). Pilih "Original" supaya slide tampil UTUH.
    step = 'crop Original';
    const cropBtn = page.locator(`${DIALOG} svg[aria-label="Select crop"]`);
    if (!(await cropBtn.count())) throw new StepError(step, 'tombol "Select crop" tidak ada (antarmuka berubah)');
    await click(cropBtn, 'Select crop'); await page.waitForTimeout(800);
    const original = page.locator(DIALOG).getByText(/^Original$/);
    if (!(await original.count())) throw new StepError(step, 'pilihan "Original" tidak ada pada menu crop');
    await click(original, 'Original'); await page.waitForTimeout(1500);
    await shot('01b-crop-original');

    step = 'Next (potong)';
    await click(await needButton(step, /^Next$/i, 'Next'), 'Next'); await page.waitForTimeout(2000);
    step = 'Next (filter)';
    await click(await needButton(step, /^Next$/i, 'Next'), 'Next'); await page.waitForTimeout(2000);
    step = 'langkah caption';
    const share = await needButton(step, /^Share$/i, 'Share (diperiksa ADA; diklik hanya pada mode live)');
    await shot('02-langkah-caption');

    step = 'isi caption';
    const cap = page.locator(`${DIALOG} [role=textbox], ${DIALOG} textarea, ${DIALOG} [contenteditable=true]`).first();
    if (!(await cap.count())) throw new StepError(step, 'kolom caption tidak ditemukan');
    await cap.click(); await page.keyboard.insertText(pkg.captionFull); await page.waitForTimeout(1200);
    const typed = (await cap.innerText().catch(() => '')).replace(/\s+/g, ' ');
    if (!typed.includes(pkg.captionFull.replace(/\s+/g, ' ').slice(0, 40))) throw new StepError(step, 'caption yang terisi tidak cocok dengan paket');
    await shot('03-caption-terisi');
    return { kit, share };
  } catch (e) { await shot('galat').catch(() => {}); throw fail(e); }
}

/** Buang draf (Escape lalu Discard) supaya dry-run tidak meninggalkan apa pun di akun. */
export async function discardDraft({ page, kit, log = () => {} }) {
  try {
    await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
    const discard = page.getByRole('button', { name: /^Discard$/i });
    if (await discard.count()) { await kit.click(discard, 'Discard'); log('draf dibuang'); }
  } catch (e) { log(`peringatan: gagal membuang draf (${String(e.message).slice(0, 80)})`); }
}

/** DRY-RUN: persiapan lengkap, BERHENTI sebelum Share, buang draf. */
export async function dryRunInstagram({ page, pkg, evidenceDir, log = () => {} }) {
  let prep = null;
  try {
    prep = await prepareInstagram({ page, pkg, evidenceDir, dryRun: true, log });
    return { ok: true, stoppedBefore: 'Share', slides: pkg.slides.length, captionChars: pkg.captionFull.length, evidenceDir };
  } finally { await discardDraft({ page, kit: prep?.kit ?? makeKit({ page, evidenceDir, dryRun: true, log }), log }); }
}

/**
 * LIVE: persiapan yang sama, lalu tekan Share (izin eksplisit) dan verifikasi hasilnya.
 * onBeforeShare dipanggil TEPAT sebelum klik (tulis-dulu ke ledger: status sedang_diposting). Hasil:
 *  - { status: 'diposting' }  teks sukses terlihat;
 *  - { status: 'tidak_pasti', reason } setelah klik tetapi sukses tidak terkonfirmasi (TIDAK PERNAH dicoba ulang otomatis; owner memeriksa akun).
 * Galat SEBELUM klik dilempar sebagai StepError (belum ada yang terkirim; draf dibuang).
 */
export async function postInstagram({ page, pkg, evidenceDir, log = () => {}, onBeforeShare = async () => {} }) {
  let prep = null; let clicked = false;
  try {
    prep = await prepareInstagram({ page, pkg, evidenceDir, dryRun: false, log });
    await onBeforeShare();
    await prep.kit.click(prep.share, 'Share', { allowFinal: true });
    clicked = true;
    try {
      await page.locator(DIALOG).getByText(SUCCESS_RE).first().waitFor({ state: 'visible', timeout: 90000 });
      await prep.kit.shot('04-terkirim');
      log('Instagram mengonfirmasi: post dibagikan');
      return { status: 'diposting', slides: pkg.slides.length, evidenceDir };
    } catch {
      await prep.kit.shot('04-hasil-tidak-pasti');
      const failure = await page.locator(DIALOG).getByText(FAILURE_RE).count().catch(() => 0);
      return { status: 'tidak_pasti', reason: failure ? 'Instagram menampilkan pesan gagal setelah Share (post mungkin tidak terkirim)' : 'teks sukses tidak muncul dalam 90 detik setelah Share', evidenceDir };
    }
  } finally {
    if (clicked) { try { await page.keyboard.press('Escape'); } catch { /* abaikan */ } }          // tutup dialog hasil; jangan pernah "Discard" setelah Share
    else await discardDraft({ page, kit: prep?.kit ?? makeKit({ page, evidenceDir, dryRun: true, log }), log }); // belum terkirim: buang draf
  }
}
