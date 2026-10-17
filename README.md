# AI Agent Office

Digital office berbasis AI agent. Division pertama: **EdukasiAI** (carousel berita AI: copywriting + desain).
Core platform: Paperclip (upstream, tanpa fork). Folder ini adalah repo kita sekaligus memori bersama
antara owner, Claude Code (builder), dan Claude chat (reviewer).

## Mulai dari mana

| Kamu adalah | Baca berurutan |
| --- | --- |
| Claude Code | `CLAUDE.md` → `loop/LOOP.md` → `loop/BACKLOG.md` (task aktif) → `docs/PRD.md` |
| Claude chat (reviewer) | `STATUS.md` → `reports/LOOP-FINAL.md` → `loop/DECISIONS.md` → review gate di `reports/review/` |
| Owner | `STATUS.md` → `loop/OWNER-QUEUE.md` → `reports/LOOP-FINAL.md` |

Claude Code bekerja dengan **cara kerja loop** (`loop/LOOP.md`): mengerjakan backlog task demi task tanpa bertanya,
lalu berhenti dengan laporan singkat saat selesai, saat hanya tersisa hal milik owner, atau saat HARD STOP.
Owner melanjutkan dengan mengetik `lanjutkan`. Tidak ada hook atau script yang memaksa sesi berjalan.

## Isi folder

| Folder/file | Isi | Ditulis oleh |
| --- | --- | --- |
| `STATUS.md` | Ringkasan loop, dibuat otomatis | `node scripts/loop-status.js --write-status` |
| `loop/` | Cara kerja loop, backlog, defaults, keputusan, antrian owner, prompt reviewer, journal | Claude Code (+ owner untuk aturan) |
| `CLAUDE.md` | Aturan kerja Claude Code | Owner/Claude chat |
| `docs/PRD.md` | Spesifikasi produk (salinan dari versi live) | Claude chat |
| `docs/decisions/` | ADR: keputusan arsitektur | Siapa pun, sebelum implementasi |
| `docs/spike/` | Hasil Fase 0 | Claude Code |
| `docs/versions.md` | Versi Paperclip, Node, Playwright yang dipin | Claude Code |
| `reports/build/` | Laporan per requirement ID | Claude Code |
| `reports/review/` | Review dengan format VERDICT | Claude chat |
| `reports/kpi/` | Laporan KPI mingguan | Script |
| `plugins/` | Plugin Paperclip milik kita | Claude Code |
| `divisions/edukasiai/` | Agent, SOP, brand kit, template slide | Claude Code + owner |
| `schemas/` | JSON Schema antar tahap pipeline | Claude Code |
| `scripts/` | Install division, render, laporan KPI | Claude Code |
| `workspace/`, `output/` | Data kerja agent dan paket publikasi (tidak di-commit) | Agent dan tool |

## Konvensi nama file laporan

- Build: `reports/build/<ID>.md` (contoh `F0.1.md`)
- Review gate: `reports/review/G<n>-review.md`
- Bukti: `docs/evidence/<ID>/`
- KPI: `reports/kpi/kpi-YYYY-Www.md` (contoh `kpi-2026-W42.md`)
- ADR: `docs/decisions/ADR-NNNN-judul-singkat.md`

PRD live: https://claude.ai/code/artifact/f0ba044d-9bf2-4335-a370-35588670764b
