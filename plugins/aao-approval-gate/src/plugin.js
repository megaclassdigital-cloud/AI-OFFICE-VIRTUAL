// Definisi plugin aao-approval-gate.
//
// File ini HANYA mendefinisikan plugin dan mengekspornya. Tidak memulai RPC.
// Dengan begitu file ini aman di-import oleh test (lihat tests/) tanpa
// menghidupkan proses worker.
//
// Yang memulai RPC adalah src/worker.js (bootstrap tipis).
//
// F0.4 = versi "hello": satu tool deterministik, untuk membuktikan plugin bisa
// menambah tool tanpa menyentuh core Paperclip (AC0.4).
// Tool nyata (verifikasi sumber, render, approval, prepare_publication)
// menyusul di F1.3, F1.8, F2.1, F2.2.
//
// Aturan: plugin ini generik untuk semua division. Tidak boleh ada logika yang
// hanya berlaku untuk EdukasiAI (CLAUDE.md aturan 7).

import { definePlugin } from '@paperclipai/plugin-sdk';

export const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info('aao-approval-gate worker siap');

    // Tool "hello" — deterministik, tanpa efek samping, tanpa LLM.
    // Sengaja mengembalikan data yang bisa diperiksa ulang (echo + panjang +
    // waktu server) supaya buktinya bukan sekadar "tool terpanggil".
    ctx.tools.register(
      'aao_hello',
      {
        displayName: 'AAO Hello',
        description:
          'Tool uji kelayakan Fase 0. Mengembalikan kembali teks yang dikirim beserta waktu server. Tidak mengubah apa pun.',
        parametersSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Teks apa saja yang ingin dipantulkan kembali.',
            },
          },
          required: ['message'],
        },
      },
      async (params) => {
        const message = String(params?.message ?? '');
        const receivedAt = new Date().toISOString();

        ctx.logger.info('aao_hello dipanggil', { length: message.length });

        return {
          content: `aao_hello menerima: ${message}`,
          data: {
            ok: true,
            echo: message,
            length: message.length,
            receivedAt,
            plugin: 'aao-approval-gate',
          },
        };
      }
    );
  },

  async onHealth() {
    return { status: 'ok', message: 'aao-approval-gate berjalan' };
  },
});

export default plugin;
