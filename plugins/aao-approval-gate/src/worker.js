// Bootstrap worker aao-approval-gate.
//
// Ini entrypoint yang dijalankan host (fork + stdio NDJSON).
//
// KENAPA tidak memakai `runWorker(plugin, import.meta.url)`:
// `runWorker` hanya memulai RPC jika `isWorkerEntrypoint()` benar, yaitu
// realpath(import.meta.url) === realpath(process.argv[1]). Di Windows
// perbandingan itu gagal pada instalasi ini, sehingga worker hidup tetapi
// diam, host menunggu balasan "initialize", lalu SIGKILL setelah 15 detik
// tanpa satu pun baris stderr. Gejalanya menyesatkan karena tidak ada error.
//
// README SDK menyebut pola ini sebagai cara resmi: bootstrap tipis yang
// memanggil startWorkerRpcHost langsung, tanpa cek main-module.
// Lihat @paperclipai/plugin-sdk/dist/worker-rpc-host.js.

import { startWorkerRpcHost } from '@paperclipai/plugin-sdk';
import plugin from './plugin.js';

startWorkerRpcHost({ plugin });
