// Manifest plugin aao-approval-gate.
//
// Paperclip memuat manifest sebagai MODUL JS (bukan JSON) dan mengambil default export.
// Lokasinya ditunjuk oleh `paperclipPlugin.manifest` di package.json.
//
// Sumber kebenaran skema (dibaca langsung, bukan ditebak):
//   @paperclipai/server/dist/services/plugin-loader.js   -> resolveManifestPath, loadManifestFromPath
//   @paperclipai/shared/dist/validators/plugin.js        -> pluginManifestV1Schema
//   @paperclipai/shared/dist/constants.js                -> PLUGIN_CATEGORIES, PLUGIN_CAPABILITIES
//
// Aturan silang yang relevan: mendeklarasikan `tools` mewajibkan capability
// `agent.tools.register`.

import { TOOL_DEFS } from './src/agent-tools.js';

export default {
  id: 'aao-approval-gate',
  apiVersion: 1,
  version: '0.2.1',
  displayName: 'AAO Approval Gate',
  description:
    'Tool deterministik untuk AI Agent Office. F0.4: versi hello dengan satu tool uji tanpa efek samping.',
  author: 'AI Agent Office',
  categories: ['automation'],
  capabilities: ['agent.tools.register', 'issues.read', 'issues.update', 'issue.comments.create', 'issue.documents.write'],
  entrypoints: {
    worker: 'src/worker.js',
  },
  tools: [
    {
      name: 'aao_hello',
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
    ...Object.entries(TOOL_DEFS).map(([name, d]) => ({ name, ...d })),
  ],
};
