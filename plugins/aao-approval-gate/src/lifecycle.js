// State machine siklus hidup issue (F1.0e). Generik untuk semua division.
//
// Status issue Paperclip adalah enum tetap, jadi state domain dipetakan ke status yang ada:
//   awaiting_approval -> in_review   (agent selesai, menunggu owner)
//   needs_human       -> blocked     (agent berhenti, butuh owner)
//   approved          -> done        (hanya owner/approval gate)
//   rejected          -> cancelled   (hanya owner/approval gate)
// Hanya aktor "owner" yang boleh menutup issue; agent berhenti di in_review atau blocked.

export const DOMAIN_STATE = Object.freeze({
  awaiting_approval: 'in_review',
  needs_human: 'blocked',
  approved: 'done',
  rejected: 'cancelled',
});

const TRANSITIONS = Object.freeze({
  agent: {
    todo: ['in_progress'],
    in_progress: ['in_review', 'blocked'],
    blocked: ['in_progress'],
    in_review: ['in_progress'],
  },
  owner: {
    todo: ['in_progress', 'cancelled'],
    in_progress: ['in_review', 'blocked', 'cancelled'],
    blocked: ['in_progress', 'cancelled'],
    in_review: ['done', 'cancelled', 'in_progress'],
  },
});

export const TERMINAL = Object.freeze(['done', 'cancelled']);

export function allowedFrom(actor, from) {
  return TRANSITIONS[actor]?.[from] ?? [];
}

export function canTransition(actor, from, to) {
  return allowedFrom(actor, from).includes(to);
}

/** Status tempat agent sudah selesai dan tidak perlu dibangunkan lagi (tidak ada heartbeat baru). */
export function isAgentIdleState(status) {
  return status === 'in_review' || status === 'blocked' || TERMINAL.includes(status);
}
