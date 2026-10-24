export type PendingApproval = { sessionId: string; threadId: string; toolCallId: string; args: Record<string, unknown> };
const state = globalThis as typeof globalThis & { accessForAllApprovals?: Map<string, PendingApproval> };
const pending = (state.accessForAllApprovals ??= new Map());

export function addApproval(key: string, approval: PendingApproval) { pending.set(key, approval); }
export function consumeApproval(key: string) { const value = pending.get(key); pending.delete(key); return value ?? null; }
