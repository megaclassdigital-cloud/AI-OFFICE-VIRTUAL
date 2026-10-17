// tiktok.mjs — alur unggah carousel FOTO ke TikTok Studio web (ADR-0005). Seperti instagram.mjs: persiapan bersama untuk dry-run dan live; dry-run berhenti
// sebelum Post; semua klik berpagar (assertClickAllowed). Diverifikasi 16 Okt 2026 (TikTok Studio berbahasa Inggris): tab "Videos | Photos", sampai 35 foto,
// kolom judul (maks 90) dan deskripsi (maks 4000, editor Draft.js), tombol Post / Save draft / Discard.
// PERHATIAN: pesan "N photos uploaded" muncul SEBELUM Post ditekan; BUKAN bukti terkirim. Bukti terkirim = pindah ke halaman konten Studio atau dialog "Manage your posts".
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { assertClickAllowed } from './guards.mjs';
import { deriveTitle } from './package.mjs';
import { StepError } from './instagram.mjs';

export const UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload';
export const SENT_RE = /(manage your posts|your (photos?|post|video)[^.]{0,40}(is|are|has been|have been) (now )?(being )?(published|posted|uploaded|live))/i;
export const SENT_URL_RE = /tiktokstudio\/content/;
const MODAL_CONTINUE_RE = /^(Post now|Post anyway|Continue)$/i; // dialog konfirmasi yang bisa muncul setelah Post (mis. pemeriksaan konten belum selesai)

function makeKit({ page, evidenceDir, dryRun, log }) {
  const click = async (loc, label, { allowFinal = false } = {}) => { assertClickAllowed(label, { dryRun, allowFinal }); log(`klik: ${label}`); await loc.first().click({ timeout: 15000 }); };
  const shot = async (name) => { await page.screenshot({ path: path.join(evidenceDir, `${name}.png`) }).catch(() => {}); };
  return { click, shot };
}

/** Persiapan: sampai semua foto terunggah, judul dan deskripsi terisi dan terverifikasi. Mengembalikan alat dan tombol Post (belum diklik). */
export async function prepareTikTok({ page, pkg, evidenceDir, dryRun, log = () => {} }) {
  mkdirSync(evidenceDir, { recursive: true });
  const kit = makeKit({ page, evidenceDir, dryRun, log });
  let step = 'awal';
  const fail = (e) => (e instanceof StepError ? e : new StepError(step, String(e.message).split('\n')[0].slice(0, 240)));
  try {
    step = 'halaman';
    if (!/tiktokstudio\/upload/.test(page.url())) await page.goto(UPLOAD_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');
    if (/\/login|\/signup/.test(page.url())) throw new StepError(step, `TikTok meminta login (${page.url().split(String.fromCharCode(63))[0]}); jalankan social-login.mjs --platform tiktok`);
    const tab = page.getByText(/^Photos$/).first();
    try { await tab.waitFor({ state: 'visible', timeout: 60000 }); } catch { throw new StepError(step, 'tab "Photos" tidak muncul di TikTok Studio (antarmuka berubah atau halaman belum termuat)'); }
    await page.waitForTimeout(1500);
    step = 'tab Photos';
    await kit.click(tab, 'Photos (tab)'); await page.waitForTimeout(2000);

    step = 'unggah foto';
    const input = page.locator('input[type=file]').last();
    if (!(await input.count())) throw new StepError(step, 'input unggah foto tidak ada');
    await input.setInputFiles(pkg.slides.map((s) => s.path));
    const want = new RegExp(`${pkg.slides.length} photos? uploaded`, 'i');
    const t0 = Date.now(); let ok = false;
    while (Date.now() - t0 < 120000) { if (want.test(await page.evaluate(() => document.body.innerText))) { ok = true; break; } await page.waitForTimeout(2000); }
    if (!ok) throw new StepError(step, `tidak semua ${pkg.slides.length} foto terunggah dalam 120 dtk`);

    step = 'isi judul';
    const title = deriveTitle(pkg.caption, 90);
    const titleBox = page.getByPlaceholder(/Add a catchy title/i);
    if (!(await titleBox.count())) throw new StepError(step, 'kolom judul tidak ditemukan');
    await titleBox.first().click(); await page.keyboard.insertText(title); await page.waitForTimeout(800);
    if ((await titleBox.first().inputValue()) !== title) throw new StepError(step, 'judul yang terisi tidak cocok');

    step = 'isi deskripsi';
    const editor = page.locator('.public-DraftEditor-content').first();
    if (!(await editor.count())) throw new StepError(step, 'editor deskripsi tidak ditemukan');
    await editor.click(); await page.keyboard.insertText(pkg.captionFull); await page.waitForTimeout(1500);
    const typed = (await editor.innerText().catch(() => '')).replace(/\s+/g, ' ');
    if (!typed.includes(pkg.captionFull.replace(/\s+/g, ' ').slice(0, 40))) throw new StepError(step, 'deskripsi yang terisi tidak cocok dengan paket');
    const counters = await page.evaluate(() => (document.body.innerText.match(/\d+\s*\/\s*\d+/g) ?? []).slice(0, 4));
    log(`penghitung formulir: ${counters.join(' | ')}`);
    // Hashtag terakhir memunculkan daftar saran yang menutupi tombol di bawahnya (Add sound): Escape lalu klik judul "Details" (netral) untuk melepas fokus editor.
    await page.keyboard.press('Escape').catch(() => {});
    const neutral = page.getByText(/^Details$/).first();
    if (await neutral.count()) await kit.click(neutral, 'Details (tutup saran hashtag)').catch(() => {});
    await page.waitForTimeout(800);

    step = 'pilih sound';
    const sound = await chooseTopSound({ page, kit, log });

    step = 'tombol Post';
    const post = page.getByRole('button', { name: /^Post$/ });
    try { await post.first().waitFor({ state: 'visible', timeout: 15000 }); } catch { throw new StepError(step, 'tombol "Post" tidak ada (diperiksa ADA, tidak diklik pada dry-run)'); }
    await kit.shot('01-formulir-terisi');
    return { kit, post, title, sound };
  } catch (e) { await kit.shot('galat').catch(() => {}); throw fail(e); }
}

const USE_BTN = (page) => page.getByRole('button', { name: /^Use$/i });

/** Buka tab panel sound dan kembalikan tombol "Use" pertama (lagu paling atas); null bila tab/lagunya tidak ada. */
async function topUse({ page, kit, tab }) {
  const t = page.getByRole('tab', { name: new RegExp(`^${tab}$`, 'i') }).or(page.getByText(new RegExp(`^${tab}$`, 'i')));
  if (!(await t.count())) return null;
  await kit.click(t, `${tab} (tab)`); await page.waitForTimeout(2500);
  const first = USE_BTN(page).first();
  if (!(await first.count())) { // tombol bisa baru muncul saat baris disorot
    const row = page.locator('[class*=music], [class*=Music], [class*=sound], [class*=Sound]').filter({ hasText: /\d|\w/ }).first();
    await row.hover({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(600);
  }
  return (await first.count()) ? first : null;
}

/**
 * Wajib: pasang lagu PALING ATAS. Urutan: tab Favorites (owner yang mengurasi dan menggulir sendiri), bila kosong tab For You (sudah disesuaikan
 * algoritma TikTok untuk akun). Tak ada lagu sama sekali atau hasil tidak terverifikasi => StepError; posting dibatalkan SEBELUM Post.
 */
export async function chooseTopSound({ page, kit, log = () => {} }) {
  const step = 'pilih sound';
  const add = page.getByText(/^Add sound$/).or(page.getByRole('button', { name: /Add sound/i }));
  if (!(await add.count())) throw new StepError(step, 'tombol "Add sound" tidak ada (antarmuka berubah)');
  await kit.click(add, 'Add sound'); await page.waitForTimeout(3000);
  let from = 'Favorites';
  let use = await topUse({ page, kit, tab: 'Favorites' });
  if (!use) { from = 'For You'; log('Favorites kosong; memakai lagu teratas For You'); use = await topUse({ page, kit, tab: 'For You' }); }
  if (!use) throw new StepError(step, 'tidak ada lagu di Favorites maupun For You (posting dibatalkan, tidak terkirim)');
  log(`sound: memakai lagu paling atas di ${from}`);
  await kit.click(use, 'Use (sound)'); await page.waitForTimeout(2500);
  const done = page.getByRole('button', { name: /^(Confirm|Done|Save|Apply|OK)$/i });
  if (await done.count()) { await kit.click(done, 'Confirm (sound)'); await page.waitForTimeout(2000); }
  const info = await page.evaluate(() => { const e = [...document.querySelectorAll('div,span,p')].find((x) => /^Sound$/.test((x.innerText || '').trim())); return e ? (e.parentElement.innerText || '').split(/\s+/).join(' ').slice(0, 200) : ''; });
  if (!info || !/Replace/i.test(info) || /Add sound/i.test(info)) throw new StepError(step, `sound tidak terpasang di formulir (bagian Sound: "${info.slice(0, 80)}")`);
  log(`sound terpasang: ${info.replace(/\s*Replace.*$/i, '').slice(0, 80)}`);
  return { from, label: info.replace(/^Sound\s*/i, '').replace(/\s*Replace.*$/i, '').slice(0, 80) };
}

/** Buang unggahan (tombol Discard) supaya dry-run tidak meninggalkan apa pun. */
export async function discardUpload({ page, kit, log = () => {} }) {
  try {
    const d = page.getByRole('button', { name: /^Discard$/i });
    if (await d.count()) { await kit.click(d, 'Discard'); await page.waitForTimeout(1500); log('unggahan dibuang'); }
  } catch (e) { log(`peringatan: gagal membuang unggahan (${String(e.message).slice(0, 80)})`); }
}

/** DRY-RUN: persiapan lengkap, BERHENTI sebelum Post, buang unggahan. */
export async function dryRunTikTok({ page, pkg, evidenceDir, log = () => {} }) {
  let prep = null;
  try {
    prep = await prepareTikTok({ page, pkg, evidenceDir, dryRun: true, log });
    return { ok: true, stoppedBefore: 'Post', sound: prep.sound, slides: pkg.slides.length, captionChars: pkg.captionFull.length, evidenceDir };
  } finally { await discardUpload({ page, kit: prep?.kit ?? makeKit({ page, evidenceDir, dryRun: true, log }), log }); }
}

/**
 * LIVE: persiapan yang sama, lalu Post (izin eksplisit) dan verifikasi. Hasil: { status:'diposting' } bila TikTok mengonfirmasi (halaman konten Studio
 * atau "Manage your posts"); { status:'tidak_pasti', reason } bila sudah diklik tetapi tidak terkonfirmasi (TIDAK pernah diulang otomatis).
 */
export async function postTikTok({ page, pkg, evidenceDir, log = () => {}, onBeforeShare = async () => {} }) {
  let prep = null; let clicked = false;
  try {
    prep = await prepareTikTok({ page, pkg, evidenceDir, dryRun: false, log });
    await onBeforeShare();
    await prep.kit.click(prep.post, 'Post', { allowFinal: true });
    clicked = true;
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      if (SENT_URL_RE.test(page.url()) || (await page.getByText(SENT_RE).count().catch(() => 0))) { await prep.kit.shot('02-terkirim'); log('TikTok mengonfirmasi: post terkirim'); return { status: 'diposting', slides: pkg.slides.length, sound: prep.sound, evidenceDir }; }
      const modal = page.locator('div[role=dialog], div[class*=modal]').getByRole('button', { name: MODAL_CONTINUE_RE });
      if (await modal.count().catch(() => 0)) await prep.kit.click(modal, (await modal.first().innerText().catch(() => 'Continue')).trim(), { allowFinal: true }); // dialog konfirmasi setelah Post
      await page.waitForTimeout(2000);
    }
    await prep.kit.shot('02-hasil-tidak-pasti');
    return { status: 'tidak_pasti', reason: 'konfirmasi terkirim tidak muncul dalam 90 detik setelah Post', evidenceDir };
  } finally {
    if (!clicked) await discardUpload({ page, kit: prep?.kit ?? makeKit({ page, evidenceDir, dryRun: true, log }), log });
  }
}
