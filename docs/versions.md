# Versi yang dipin

Diisi oleh Claude Code di F0.1. Upgrade hanya lewat tugas terpisah dengan regression test.

| Komponen | Versi | Tanggal dipin | Catatan |
| --- | --- | --- | --- |
| Windows | 10 Home Single Language 10.0.19045 (build 19045, HAL 10.0.19041.6456) | 2026-10-04 | `[System.Environment]::OSVersion` + `Get-ComputerInfo` |
| Node.js | v24.19.0 | 2026-10-04 | Diinstal di F0.1 via `winget install OpenJS.NodeJS.LTS`. Sebelumnya Node tidak ada di mesin. Lokasi: `C:\Program Files\nodejs\` |
| npm / pnpm | npm 11.17.0 (npx 11.17.0) | 2026-10-04 | Bundled dengan Node 24.19.0. npm 12.2.0 tersedia tetapi **tidak** di-upgrade (aturan 9: upgrade = tugas terpisah) |
| Paperclip | 2026.1001.0 (dist-tag `latest`) | 2026-10-04 | npm `paperclipai`, MIT, repo `git+https://github.com/paperclipai/paperclip.git`. Channel lain yang ada: beta `2026.1002.0-beta.0`, nightly `2026.1003.0-nightly.0`, canary `2026.1004.0-canary.2` — tidak dipakai |
| @paperclipai/plugin-sdk | 2026.1001.0 | 2026-10-04 | Dicatat untuk F0.4, belum dipasang |
| Playwright | 1.56.0 | 2026-10-05 | npm `playwright`, devDependency di root `package.json`. Browser: chromium-1194 + chromium_headless_shell-1194 + ffmpeg-1011 + winldd-1007 di `%LOCALAPPDATA%\ms-playwright` (**550,1 MB**) |
| Adapter agent | `codex_local` | 2026-10-05 | Dipilih owner. Satu-satunya adapter yang lolos `test-environment`. Memakai kredensial Codex owner di `~/.codex`; biaya tercatat `subscription_included` = USD 0 |
| Embedded PostgreSQL | 18.1 (`@embedded-postgres/windows-x64`) | 2026-10-04 | Dibawa oleh Paperclip, bukan dipasang terpisah. Port 54329 |
| MS Visual C++ Redistributable x64 | 14.51.36247.0 | 2026-10-04 | **Diupgrade di F0.1 dari 14.23.27820.** Prasyarat PostgreSQL 18; versi lama membuat `postgres.exe` crash `0xC0000005` |

## Catatan instalasi F0.1

- Semua perintah `npx` dipin eksplisit ke `paperclipai@2026.1001.0`, bukan `paperclipai` tanpa versi,
  agar run berikutnya tidak diam-diam ikut rilis baru.
- Database: embedded Postgres, data dir `C:\Users\Farrel\.paperclip\instances\default\db`, port **54329**.
- Server Paperclip dikonfigurasi di port **3100** oleh wizard `onboard` (default).
  Port ini **sudah dipakai** oleh dev server lain milik owner (`next dev --turbopack -p 3100` dari `D:\ERP-KIOS`).
  Lihat laporan build `reports/build/2026-10-04_F0.1.md` bagian risiko.
