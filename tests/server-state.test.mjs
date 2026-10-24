import test from "node:test";
import assert from "node:assert/strict";
import { clearSessionContext, getSessionContext, setSessionContext } from "../src/lib/transcript-store.ts";
import { addApproval, consumeApproval } from "../src/lib/approvals.ts";
import { allowRequest } from "../src/lib/rate-limit.ts";

test("temporary transcript context can be updated and explicitly cleared", () => {
  const sessionId = "test_session_1234567890";
  const segments = [{ id: "item-1", text: "A finalized caption", createdAt: Date.now() }];
  setSessionContext(sessionId, { segments, preferences: { language: "hi", level: "beginner" } });
  assert.deepEqual(getSessionContext(sessionId)?.segments, segments);
  assert.deepEqual(getSessionContext(sessionId)?.preferences, { language: "hi", level: "beginner" });
  clearSessionContext(sessionId);
  assert.equal(getSessionContext(sessionId), null);
});

test("approval keys are single use", () => {
  const key = "test-approval-once";
  const approval = { sessionId: "session-1", threadId: "main", toolCallId: "call-1", args: { request: "captions" } };
  addApproval(key, approval);
  assert.deepEqual(consumeApproval(key), approval);
  assert.equal(consumeApproval(key), null);
});

test("request limiter rejects requests above its window limit", () => {
  const key = `test-rate-${Date.now()}`;
  assert.equal(allowRequest(key, 2, 60_000), true);
  assert.equal(allowRequest(key, 2, 60_000), true);
  assert.equal(allowRequest(key, 2, 60_000), false);
});
