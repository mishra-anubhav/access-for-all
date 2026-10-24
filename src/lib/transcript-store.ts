export type TranscriptSegment = {
  id: string;
  text: string;
  createdAt: number;
  translation?: string;
};

type SessionContext = {
  segments: TranscriptSegment[];
  preferences: { language?: string; level?: string };
  expiresAt: number;
};

const store = globalThis as typeof globalThis & { accessForAllContexts?: Map<string, SessionContext> };
const contexts = (store.accessForAllContexts ??= new Map<string, SessionContext>());

export function setSessionContext(sessionId: string, patch: Partial<SessionContext>) {
  const previous = contexts.get(sessionId);
  contexts.set(sessionId, {
    segments: patch.segments ?? previous?.segments ?? [],
    preferences: patch.preferences ?? previous?.preferences ?? {},
    expiresAt: Date.now() + 30 * 60 * 1000,
  });
}

export function getSessionContext(sessionId: string) {
  const item = contexts.get(sessionId);
  if (!item || item.expiresAt < Date.now()) {
    contexts.delete(sessionId);
    return null;
  }
  return item;
}

export function clearSessionContext(sessionId: string) {
  contexts.delete(sessionId);
}
