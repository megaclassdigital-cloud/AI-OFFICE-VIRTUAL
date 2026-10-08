# Lisensi aset Office View

Semua aset Office View ada di `apps/office-view/public/`. Tidak ada font, gambar, atau skrip yang dimuat dari internet saat berjalan.

| Aset | Asal | Lisensi | Berkas |
| --- | --- | --- | --- |
| Sprite karakter (6 lembar, 16×32 per frame) | **MetroCity Free Top-Down Character Pack** oleh **JIK-A-4** (https://jik-a-4.itch.io/metrocity-free-topdown-character-pack), disalin dari paket npm `pixel-agents@1.4.1` (`dist/assets/characters/char_0..5.png`) yang mencantumkan kreditnya | **CC0 1.0** (domain publik; boleh komersial) | `public/assets/characters/char_0.png` … `char_5.png` |
| Lantai, dinding, meja, kursi, monitor, sofa, mesin kopi, tanaman, papan, kotak approval, bubble, name tag | Digambar sendiri lewat kode Canvas (`public/office.js`) dari bentuk geometris sederhana | Milik proyek ini (tanpa pihak ketiga) | — |
| Emoji (⌨️ 💬 📄 ❌ ✋ 🎉 ☕ 🐞 ⚠️ 😴) | Font emoji sistem pengguna (Segoe UI Emoji) dirender oleh browser; tidak dibundel | Bagian dari OS, tidak didistribusikan | — |
| Font teks UI | `Segoe UI` / `system-ui` bawaan sistem; tidak dibundel | Bagian dari OS | — |

## Yang sengaja TIDAK dipakai

- Perabot, lantai, dan dinding bawaan Pixel Agents (README hanya menyatakan kode MIT; lisensi aset non-karakter tidak dinyatakan terpisah, jadi tidak dipakai).
- Kode Pixel Agents (hanya dibaca untuk menilai kelayakan, lihat D-014); tidak ada kode yang disalin.
- Star Office UI (lisensi melarang pemakaian komersial; ditolak di ADR-0003).

## Catatan

CC0 tidak mensyaratkan atribusi, tetapi kredit tetap dicantumkan di sini sebagai penghargaan kepada JIK-A-4.
