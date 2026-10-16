// package.mjs — paket posting sebuah konten: slide, caption, hashtag, dan validasinya (KODE, tanpa jaringan).
// Sumber: versi TERBARU konten (runs/<EDU-n>/[revision-N]/): render/slide-XX.png dan carousel.json (caption + hashtags).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { latestRunKey, runDirOf } from '../run-registry.mjs';

/** Dimensi PNG dari header (tanpa dependensi). */
export function pngSize(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

export const LIMITS = Object.freeze({ minSlides: 2, maxSlides: 10, maxCaption: 2200, maxHashtags: 30, width: 1080, height: 1350 });

/** Judul pendek (kalimat pertama caption) untuk platform yang punya kolom judul terpisah (TikTok maks 90). Dipotong di batas kata, tanpa elipsis. */
export function deriveTitle(caption, max = 90) {
  const first = String(caption ?? '').split(/[.!?\n]/)[0].trim();
  if (first.length <= max) return first;
  const cut = first.slice(0, max); const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).trim();
}

/** Urutan lagu Favorites TikTok yang dipakai: bergiliran menurut jumlah posting TikTok sebelumnya (mod jumlah favorit). 0 bila tidak ada favorit. */
export function pickSoundIndex(postedCount, available) {
  const n = Number(available) || 0;
  return n > 0 ? (((Number(postedCount) || 0) % n) + n) % n : 0;
}

/** Susun caption akhir: caption + baris kosong + hashtag (sekali saja bila caption sudah memuatnya). */
export function composeCaption(caption, hashtags) {
  const c = String(caption ?? '').trim();
  const tags = (hashtags ?? []).map((h) => String(h).trim()).filter(Boolean);
  const missing = tags.filter((h) => !c.includes(h));
  return missing.length ? `${c}\n\n${missing.join(' ')}` : c;
}

/** Murni: validasi paket. Mengembalikan daftar galat (kosong = layak). */
export function validatePackage({ slides, caption, hashtags }) {
  const errors = [];
  if (slides.length < LIMITS.minSlides) errors.push(`slide kurang dari ${LIMITS.minSlides} (${slides.length})`);
  if (slides.length > LIMITS.maxSlides) errors.push(`slide lebih dari ${LIMITS.maxSlides} (${slides.length})`);
  for (const s of slides) if (!s.size) errors.push(`${s.name}: bukan PNG yang valid`); else if (s.size.w !== LIMITS.width || s.size.h !== LIMITS.height) errors.push(`${s.name}: ${s.size.w}x${s.size.h}, seharusnya ${LIMITS.width}x${LIMITS.height}`);
  if (!String(caption ?? '').trim()) errors.push('caption kosong');
  if (composeCaption(caption, hashtags).length > LIMITS.maxCaption) errors.push(`caption lebih dari ${LIMITS.maxCaption} karakter`);
  if ((hashtags ?? []).length > LIMITS.maxHashtags) errors.push(`hashtag lebih dari ${LIMITS.maxHashtags}`);
  return errors;
}

/** Bangun paket dari folder run versi terbaru konten. */
export function buildPackage(outputs, contentId) {
  const runKey = latestRunKey(outputs, contentId);
  const dir = runDirOf(outputs, runKey);
  const renderDir = path.join(dir, 'render');
  const files = existsSync(renderDir) ? readdirSync(renderDir).filter((f) => /^slide-[0-9]+\.png$/.test(f)).sort() : [];
  const slides = files.map((name) => ({ name, path: path.join(renderDir, name), size: pngSize(readFileSync(path.join(renderDir, name))) }));
  let carousel = null; try { carousel = JSON.parse(readFileSync(path.join(dir, 'carousel.json'), 'utf8').replace(/^﻿/, '')); } catch { /* galat dilaporkan di validasi */ }
  const caption = carousel?.caption ?? ''; const hashtags = carousel?.hashtags ?? [];
  const errors = validatePackage({ slides, caption, hashtags });
  if (!carousel) errors.push('carousel.json tidak terbaca');
  return { contentId, runKey, dir, slides, caption, hashtags, captionFull: composeCaption(caption, hashtags), errors };
}
