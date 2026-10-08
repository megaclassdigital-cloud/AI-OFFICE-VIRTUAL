# Install log — F0.1: Instal Paperclip di Windows

- Tanggal: 2026-10-04
- Mesin: Windows 10 Home Single Language 10.0.19045, Intel Core i3-7020U @ 2.30GHz, 2 core
- Shell: PowerShell 5.1
- Dikerjakan oleh: Claude Code

Semua perintah dan output di bawah ini output asli, tidak diparafrasekan. Potongan panjang ditandai `[dipotong]`.

---

## Langkah 0 — Cek prasyarat Node (blocker dari STATUS.md)

STATUS.md mencatat `npx` tidak dikenali di PATH. Dicek lebih dulu:

```powershell
node -v; npm -v; npx -v
```

```
node : The term 'node' is not recognized as the name of a cmdlet, function, script file, or operable program.
npm  : The term 'npm' is not recognized as the name of a cmdlet, function, script file, or operable program.
npx  : The term 'npx' is not recognized as the name of a cmdlet, function, script file, or operable program.
```

Bukan sekadar masalah PATH. Node benar-benar **belum terpasang**. Lokasi instalasi umum dan registry uninstall semuanya kosong:

```
absent: C:\Program Files\nodejs
absent: C:\Program Files (x86)\nodejs
absent: C:\Users\Farrel\AppData\Local\Programs\nodejs
absent: C:\Users\Farrel\AppData\Roaming\npm
absent: C:\Users\Farrel\AppData\Roaming\nvm
absent: C:\ProgramData\nvm
absent: C:\Users\Farrel\scoop\apps\nodejs
absent: C:\Users\Farrel\AppData\Local\Volta
--- registry uninstall entries matching node ---
(kosong)
--- winget/choco present? ---
winget: yes
choco: no
```

## Langkah 1 — Instal Node.js LTS

Dasar: PRD bagian 9 (tabel risiko) sudah mengizinkan "instal Node LTS jika perlu" sebagai mitigasi F0.1.

```powershell
winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity
```

```
Found Node.js (LTS) [OpenJS.NodeJS.LTS] Version 24.19.0
Downloading https://nodejs.org/dist/v24.19.0/node-v24.19.0-x64.msi
Successfully verified installer hash
Starting package install...
Successfully installed
```

Verifikasi di shell baru (PATH machine + user dimuat ulang):

```
node -v  -> v24.19.0
npm -v   -> 11.17.0
npx -v   -> 11.17.0
node     -> C:\Program Files\nodejs\node.exe
npx      -> C:\Program Files\nodejs\npx.ps1
PATH (Machine) berisi: C:\Program Files\nodejs\
```

Blocker `npx` dari STATUS.md **selesai**.

Catatan: npm memberi notice bahwa npm 12.2.0 tersedia. **Tidak** diupgrade, sesuai aturan 9 (upgrade adalah tugas terpisah dengan regression test).

## Langkah 2 — Verifikasi paket Paperclip di npm sebelum dijalankan

Aturan 3 melarang menebak API. Registry dicek dulu:

```powershell
npm view paperclipai version dist-tags time.modified repository.url license
```

```
version = '2026.1001.0'
dist-tags = {
  latest: '2026.1001.0',
  beta: '2026.1002.0-beta.0',
  nightly: '2026.1003.0-nightly.0',
  canary: '2026.1004.0-canary.2'
}
time.modified = '2026-10-04T09:38:51.181Z'
repository.url = 'git+https://github.com/paperclipai/paperclip.git'
license = 'MIT'
```

```powershell
npm view @paperclipai/plugin-sdk version
```

```
2026.1001.0
```

Repo dan lisensi cocok dengan ADR-0001. Semua perintah berikutnya **dipin** ke `paperclipai@2026.1001.0` agar run berikutnya tidak diam-diam ikut rilis baru.

## Langkah 3 — Baca help CLI sebelum menjalankan onboard

```powershell
npx --yes paperclipai@2026.1001.0 --help
npx --yes paperclipai@2026.1001.0 onboard --help
```

Yang menentukan cara kerja langkah berikutnya:

```
onboard   Interactive first-run setup wizard
  -y, --yes              Accept quickstart defaults (trusted local loopback
                         unless --bind is set) and start immediately
  --install-service      Install and start the background service after onboarding
  --no-install-service   Do not install or suggest the background service
  -d, --data-dir <path>  Paperclip data directory root (isolates state from ~/.paperclip)
```

`--yes` berarti onboard **langsung menjalankan server**, bukan hanya menulis config.

## Langkah 4 — Jalankan onboard (percobaan 1): GAGAL

```powershell
npx --yes paperclipai@2026.1001.0 onboard --yes --no-install-service
```

Deviasi dari perintah di PRD: ditambahkan `--no-install-service`. Alasan: memasang Windows service permanen adalah perubahan sistem yang belum diminta owner. Ternyata tidak relevan — doctor melaporkan service memang tidak didukung di win32 (lihat di bawah).

Config berhasil ditulis, secret dibuat:

```
|  `--yes` enabled: using Quickstart defaults.
|  Using quickstart defaults: local_trusted/private @ loopback (127.0.0.1):3100.
*  Created PAPERCLIP_AGENT_JWT_SECRET in C:\Users\Farrel\.paperclip\instances\default\.env
*  Created PAPERCLIP_TOOL_ACTION_SIGNING_SECRET in C:\Users\Farrel\.paperclip\instances\default\.env
*  Created local secrets key file at C:\Users\Farrel\.paperclip\instances\default\secrets\master.key

o  Configuration saved
|  Database: embedded-postgres
|  LLM: not configured
|  Server: local_trusted/private @ loopback (127.0.0.1):3100
|  Secrets: local_encrypted (strict mode off)
```

Doctor:

```
|  ✓ Config file: Valid config
|  ✓ Deployment/auth mode: local_trusted mode is configured for loopback-only access
|  ✓ Agent JWT secret: PAPERCLIP_AGENT_JWT_SECRET is set in environment
|  ! Secrets adapter: ... key file permissions are 666 (run chmod 600 ...)
|  ✓ Storage: Local disk storage is writable
|  ✓ Database: Embedded PostgreSQL configured at ...\db (port 54329)
|  ✓ LLM provider: No LLM provider configured (optional)
|  ✓ Log directory: Log directory is writable
|  ✓ Server port: Port 3100 is available
|  ✓ Node.js runtime: Node.js 24.19.0
|  ✓ Managed install: Not present
|  ✓ Background service: Service management is not supported on win32. Use paperclipai run instead.

o  Summary: 11 passed, 1 warnings
```

Lalu server gagal start:

```
o  Starting Paperclip server...
[18:09:28] INFO: Using embedded PostgreSQL because no DATABASE_URL set (dataDir=...\db, port=54329)
Paperclip server failed to start.
Failed to initialize embedded PostgreSQL cluster in C:\Users\Farrel\.paperclip\instances\default\db
on port 54329: Postgres init script exited with code 1.
[18:09:33] ERROR: Embedded PostgreSQL failed; showing buffered startup logs
  {"phase":"initialise","recentLogs":[... "running bootstrap script ...","ok",
   "performing post-bootstrap initialization ..."]}
```

Exit code 1, gagal persis di tahap `performing post-bootstrap initialization`. Paperclip membersihkan sendiri data dir yang setengah jadi (db dir kembali kosong).

## Langkah 5 — Reproduksi di luar Paperclip untuk cari akar masalah

Supaya jelas ini bug Paperclip atau masalah lingkungan, `initdb` dijalankan langsung dari binary yang dibawa paket `@embedded-postgres/windows-x64`:

```powershell
$bin = "$env:LOCALAPPDATA\npm-cache\_npx\38072fe15ceb4e96\node_modules\@embedded-postgres\windows-x64\native\bin"
& "$bin\initdb.exe" --version
& "$bin\initdb.exe" -D "$env:TEMP\pgtest-f01" -U postgres -A trust -E UTF8 --locale=C
```

```
initdb (PostgreSQL) 18.1

creating directory C:/Users/Farrel/AppData/Local/Temp/pgtest-f01 ... ok
creating subdirectories ... ok
selecting dynamic shared memory implementation ... windows
selecting default "max_connections" ... 100
selecting default "shared_buffers" ... 128MB
selecting default time zone ... Asia/Bangkok
creating configuration files ... ok
running bootstrap script ... ok
performing post-bootstrap initialization ...
initdb.exe : child process was terminated by exception 0xC0000005
initdb: removing data directory "C:/Users/Farrel/AppData/Local/Temp/pgtest-f01"
EXIT CODE: 1
```

**Akar masalah ketemu:** `0xC0000005` = ACCESS_VIOLATION. `postgres.exe` crash, bukan error logika Paperclip. Jadi ini masalah lingkungan Windows owner, dan reprodusibel tanpa Paperclip sama sekali.

Diagnostik lingkungan:

```
CPU: Intel(R) Core(TM) i3-7020U CPU @ 2.30GHz, 2 core, 64-bit
Antivirus: Windows Defender, RealTimeProtectionEnabled: True

vcruntime140.dll   -> 14.23.27820.0
vcruntime140_1.dll -> 14.23.27820.0
msvcp140.dll       -> 14.23.27820.0
```

Paket embedded postgres **tidak** membawa `vcruntime140.dll` sendiri (hanya `icu*`, `libssl`, `libcrypto`, `zlib`, dll.), jadi `postgres.exe` memakai runtime sistem. Runtime sistem masih 14.23 (VS 2019, rilis 2019), sedangkan PostgreSQL 18 dibangun dengan toolchain VS 2022 dan butuh VC++ 2015–2022 Redistributable (≥ 14.40).

Hipotesis: VC++ runtime kedaluwarsa.

## Langkah 6 — Perbaikan: upgrade VC++ Redistributable

```powershell
winget install --id Microsoft.VCRedist.2015+.x64 --exact --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity
```

```
Found an existing package already installed. Trying to upgrade the installed package...
Found Microsoft Visual C++ v14 Redistributable (x64) [Microsoft.VCRedist.2015+.x64] Version 14.51.36247.0
Downloading https://download.visualstudio.microsoft.com/download/pr/ebdab8e5-1d7b-4d9f-a11b-cbb1720c3b12/...VC_redist.x64.exe
Successfully verified installer hash
Starting package install...
Successfully installed
```

Runtime sesudah upgrade:

```
vcruntime140.dll   -> 14.51.36247.0
vcruntime140_1.dll -> 14.51.36247.0
msvcp140.dll       -> 14.51.36247.0
```

## Langkah 7 — Buktikan hipotesis: `initdb` yang sama, sekarang lolos

```powershell
& "$bin\initdb.exe" -D "$env:TEMP\pgtest-f01b" -U postgres -A trust -E UTF8 --locale=C
```

```
running bootstrap script ... ok
performing post-bootstrap initialization ... ok
syncing data to disk ... ok

Success. You can now start the database server using:
    "...\pg_ctl" -D "C:\Users\Farrel\AppData\Local\Temp\pgtest-f01b" -l logfile start

EXIT CODE: 0
```

Tahap yang sebelumnya crash (`performing post-bootstrap initialization`) sekarang `ok`, dengan binary dan perintah yang sama. Satu-satunya yang berubah adalah versi VC++ runtime. Hipotesis terbukti.

Kedua data dir uji (`pgtest-f01`, `pgtest-f01b`) dihapus setelah tes.

## Langkah 8 — Jalankan ulang onboard (percobaan 2)

```powershell
npx --yes paperclipai@2026.1001.0 onboard --yes --no-install-service
```

Hasil lengkap: `evidence/F0.1-onboard-retry.log` dan `reports/build/2026-10-04_F0.1.md`.

---

## Berkas bukti

| Berkas | Isi |
| --- | --- |
| `evidence/F0.1-onboard.log` | Output lengkap onboard percobaan 1 (gagal) |
| `evidence/F0.1-onboard-retry.log` | Output lengkap onboard percobaan 2 |

## Lokasi instalasi

| Hal | Lokasi |
| --- | --- |
| Paperclip home | `C:\Users\Farrel\.paperclip` |
| Instance aktif | `C:\Users\Farrel\.paperclip\instances\default` |
| Config | `...\instances\default\config.json` |
| Secret (.env, master.key) | `...\instances\default\.env`, `...\instances\default\secrets\master.key` |
| Data embedded Postgres | `...\instances\default\db` (port 54329) |
| Log | `...\instances\default\logs` |
| Backup DB otomatis | `...\instances\default\data\backups` (tiap 60 menit, retensi 30 hari) |
| CLI (npx cache, sementara) | `C:\Users\Farrel\AppData\Local\npm-cache\_npx\38072fe15ceb4e96` |

Paperclip **tidak** dipasang di dalam repo `D:\AI-Memory\AI-Agent-Office`, sesuai CLAUDE.md ("dipasang terpisah dan tidak di-fork"). Tidak ada file Paperclip yang disentuh.

## Cara mengulang dari nol (untuk owner)

```powershell
# 1. prasyarat
winget install --id OpenJS.NodeJS.LTS --exact
winget install --id Microsoft.VCRedist.2015+.x64 --exact   # wajib, lihat Langkah 5-7

# 2. jalankan Paperclip (shell baru supaya PATH termuat)
npx --yes paperclipai@2026.1001.0 onboard --yes --no-install-service
```

Server tidak punya Windows service di win32, jadi harus dijalankan lewat `paperclipai run` dan shell-nya dibiarkan terbuka.
