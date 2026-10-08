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

export default {
  id: 'aao-approval-gate',
  apiVersion: 1,
  version: '0.3.0',
  displayName: 'AAO Approval Gate',
  description:
    'Tool deterministik untuk AI Agent Office. F0.4: versi hello dengan satu tool uji tanpa efek samping.',
  author: 'AI Agent Office',
  categories: ['automation'],
  capabilities: ['agent.tools.register', 'issues.read', 'issues.update', 'issue.comments.create', 'issue.documents.write', 'events.subscribe', 'agents.read', 'agents.pause', 'activity.log.write'],
  entrypoints: {
    worker: 'src/worker.js',
  },
  // Statis dengan sengaja: server meng-cache modul yang di-import manifest, sehingga daftar tool bisa basi.
  // Test (tests/agent-tools.test.mjs) menjaga daftar ini identik dengan TOOL_DEFS.
  tools: [
    {
      name: 'aao_hello',
      displayName: 'AAO Hello',
      description: 'Tool uji kelayakan Fase 0. Mengembalikan kembali teks yang dikirim beserta waktu server. Tidak mengubah apa pun.',
      parametersSchema: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Teks apa saja yang ingin dipantulkan kembali.'
          }
        },
        required: [
          'message'
        ]
      }
    },
    {
      name: 'post_comment',
      displayName: 'Post Comment',
      description: 'Tulis komentar di issue. Satu-satunya cara agent berkomentar; jangan memakai curl/PowerShell.',
      parametersSchema: {
        type: 'object',
        properties: {
          issueId: {
            type: 'string'
          },
          body: {
            type: 'string'
          }
        },
        required: [
          'issueId',
          'body'
        ]
      }
    },
    {
      name: 'set_issue_status',
      displayName: 'Set Issue Status',
      description: 'Ubah status issue. Hanya transisi todo->in_progress, in_progress->in_review|blocked, blocked|in_review->in_progress. done/cancelled hanya owner.',
      parametersSchema: {
        type: 'object',
        properties: {
          issueId: {
            type: 'string'
          },
          status: {
            type: 'string',
            enum: [
              'in_progress',
              'in_review',
              'blocked'
            ]
          }
        },
        required: [
          'issueId',
          'status'
        ]
      }
    },
    {
      name: 'complete_stage',
      displayName: 'Complete Stage',
      description: 'Akhiri pekerjaanmu pada issue ini: tulis ringkasan akhir dan set status menunggu owner (awaiting_approval) atau butuh manusia (needs_human). Panggil SEKALI di akhir, lalu berhenti.',
      parametersSchema: {
        type: 'object',
        properties: {
          issueId: {
            type: 'string'
          },
          outcome: {
            type: 'string',
            enum: [
              'awaiting_approval',
              'needs_human'
            ]
          },
          summary: {
            type: 'string'
          }
        },
        required: [
          'issueId',
          'outcome',
          'summary'
        ]
      }
    },
    {
      name: 'attach_file',
      displayName: 'Attach File',
      description: 'Lampirkan dokumen teks/markdown ke issue dengan key tertentu (mis. research-output).',
      parametersSchema: {
        type: 'object',
        properties: {
          issueId: {
            type: 'string'
          },
          key: {
            type: 'string'
          },
          body: {
            type: 'string'
          },
          title: {
            type: 'string'
          }
        },
        required: [
          'issueId',
          'key',
          'body'
        ]
      }
    }
  ],
};
