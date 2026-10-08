# ADR-0001: Paperclip sebagai core, tanpa fork

- Status: Diterima
- Tanggal: 2026-10-04
- Penulis: Claude (chat), disetujui owner

## Konteks

Owner tidak mengharuskan core dibangun sendiri dan meminta repo open source dengan konsep serupa.
Dua kandidat diperiksa (di-clone dan dicek struktur, lisensi, dan aktivitasnya pada 4 Okt 2026):

- **Paperclip** (`paperclipai/paperclip`, MIT): server Node.js + UI React untuk mengorkestrasi tim AI agent,
  dengan org chart, isolasi per company, issue/task, heartbeat, budget per agent, audit, plugin SDK
  (`@paperclipai/plugin-sdk` dengan test harness), dan adapter untuk claude, codex, gemini, opencode, pi,
  kimi, grok, cursor, hermes, dan openclaw. Database: embedded Postgres. Commit terakhir 4 Okt 2026, sekitar 1.873 file test.
- **Pixel Agents** (`pixel-agents-hq/pixel-agents`, MIT): visualisasi kantor pixel art dari log/hook agent.
  Hanya lapisan tampilan, tanpa task engine, approval, atau budget. Kemungkinan besar ini yang ada di video referensi.

## Keputusan

Paperclip dipakai sebagai core apa adanya. Perluasan hanya lewat plugin SDK, adapter, skill, dan konfigurasi company.
Division = Company di Paperclip. Pixel Agents ditunda.

## Alternatif yang dipertimbangkan

1. Fork Paperclip dan modifikasi core: ditolak karena upstream sangat aktif, sehingga fork akan cepat tertinggal.
2. Membangun core sendiri (SQLite + worker sederhana): menjadi cadangan jika Fase 0 gagal.
3. Pixel Agents sebagai dasar: ditolak karena hanya visualisasi.

## Konsekuensi

- Gate approval publish harus dibangun sebagai plugin (`aao-approval-gate`), karena approval bawaan Paperclip untuk tata kelola agent.
- Agent Paperclip adalah coding CLI yang punya akses shell, jadi least privilege dan tool deterministik wajib ada.
- Provider Resolver berbasis capability ditunda; sementara memakai pilihan adapter per agent.

## Cara memverifikasi

AC0.1–AC0.5 di PRD. Jika AC0.1, AC0.2, atau AC0.4 gagal, ADR ini ditinjau ulang dan opsi 2 dipertimbangkan.
