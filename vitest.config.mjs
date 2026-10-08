import { defineConfig } from 'vitest/config';

// Test deterministik repo AI Agent Office. Semua test di tests/**.
// Timeout longgar karena mesin owner 2 core dan sebagian test memulai proses Node/Chromium.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Satu berkas satu proses supaya test yang menjalankan Chromium tidak berebut CPU.
    fileParallelism: false,
    reporters: ['default'],
  },
});
