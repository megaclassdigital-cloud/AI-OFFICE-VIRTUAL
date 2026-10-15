import { readFileSync, writeFileSync } from 'node:fs';
let f = 'divisions/edukasiai/brand/design-standard.json';
const std = JSON.parse(readFileSync(f, 'utf8'));
std.referencePosts = [
  'https://www.instagram.com/p/DbfTzclGSfA/?img_index=1',
  'https://www.instagram.com/p/DbhMcOdGXcN/?img_index=1',
  'https://www.instagram.com/p/DbzNW8co-vA/?img_index=1',
  'https://www.instagram.com/p/Dc1CUHco_S0/?img_index=1',
];
std.referenceImages = [
  'divisions/edukasiai/brand/reference/ig/post1-slide1-cover.png',
  'divisions/edukasiai/brand/reference/ig/post1-slide2-isi.png',
];
std.referenceImagesCatatan = 'Empat postingan akun @edukasiai.co.id (referensi owner) adalah PATOKAN FORMAT UTAMA yang dipegang QA Finishing. Instagram butuh login, jadi gambar acuan lokal ada di reference/ig/. Owner dapat menambah slide lain ke folder itu (nama bebas, .png/.jpg); QA wajib membuka SEMUA gambar di folder itu.';
std.ownerFormat = [
  'Foto atau ilustrasi relevan memenuhi bagian atas slide (sekitar separuh tinggi), memudar halus ke area hitam di bawahnya',
  'Blok teks di kiri bawah di atas latar hitam: kicker kecil huruf kapital berjarak (warna aksen), judul/isi putih tebal',
  'Satu kata kunci per judul/kalimat ditekankan dengan warna aksen tegas (merah pada tema risiko/keamanan)',
  'Slide sampul: judul besar 2-3 baris dan subjudul miring satu kalimat; slide isi: paragraf pendek (3-4 baris), bukan daftar panjang',
  'Garis tipis dan footer di setiap slide: handle edukasiai.co.id di kiri, "Sumber: <nama media>" di kanan (abu-abu kecil)',
  'Teks Indonesia, nada ringkas dan netral; tidak ada logo/elemen dekoratif yang tidak ada di postingan acuan'
];
std.visualChecklist = [
  'Format sama dengan postingan acuan owner (gambar di reference/ig/ dan empat tautan referencePosts): foto atas memudar ke hitam, blok teks kiri bawah, kicker kecil, kata kunci beraksen, footer handle kiri dan sumber kanan',
  ...std.visualChecklist.filter((x) => !/^Palet, font, dan posisi logo/.test(x))
];
writeFileSync(f, JSON.stringify(std, null, 2) + '\n');

f = 'divisions/edukasiai/agents/qa.md';
let s = readFileSync(f, 'utf8');
const a = "Acuan tunggal: `divisions/edukasiai/brand/design-standard.json` (aturan) dan gambar acuan\n`divisions/edukasiai/brand/reference/patokan-contact-sheet.png` (contact sheet carousel standar).";
if (!s.includes(a)) throw new Error('qa anchor');
s = s.replace(a, () => "**Peran ini disebut QA Finishing.** Patokan utamanya adalah empat postingan acuan owner (`referencePosts` di `design-standard.json`; Instagram butuh login, jadi\ngunakan gambar lokal di `divisions/edukasiai/brand/reference/ig/` — buka SEMUA gambar di folder itu) beserta daftar `ownerFormat`. Bila format hasil render berbeda dari acuan itu,\n**langsung kembalikan ke Designer sebagai brief revisi**: `qa_submit_result` dengan `designOk: false` dan catatan per slide yang berbunyi \"seharusnya X (acuan), sekarang Y\",\nagar Designer tahu persis apa yang diubah. Selain itu: aturan `design-standard.json` dan contact sheet `reference/patokan-contact-sheet.png` (carousel standar).");
writeFileSync(f, s);
console.log('ok');
