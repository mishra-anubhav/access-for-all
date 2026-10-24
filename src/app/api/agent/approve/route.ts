import { NextResponse } from "next/server";
import { getTrueForge, modelText } from "@/lib/trueforge";
import { consumeApproval } from "@/lib/approvals";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.key !== "string" || !["allow", "deny"].includes(body.decision)) {
    return NextResponse.json({ error: "Choose approve or decline for the pending request." }, { status: 400 });
  }
  const pending = consumeApproval(body.key);
  if (!pending) return NextResponse.json({ error: "This approval has expired or was already used." }, { status: 404 });
  try {
    const stream = await getTrueForge().sessions.createTurnStream(pending.sessionId, {
      input: [{ type: "user.tool_approval", threadId: pending.threadId, toolCallId: pending.toolCallId,
        approval: body.decision === "allow" ? { status: "allow" } : { status: "deny", reason: "The attendee declined this request." } }],
    });
    const trace: Array<{ type: string; label: string; status: string }> = [];
    let answer = "";
    for await (const { data: event } of stream.withMetadata()) {
      if (event.type === "tool.response") trace.push({ type: event.type, label: "Demo organizer request recorded", status: "complete" });
      if (event.type === "turn.done" && event.state.status === "done" && event.state.output?.type === "model.message") answer = modelText(event.state.output.content);
    }
    return NextResponse.json({ ok: true, answer, trace, demo: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message.slice(0, 400) : "Approval could not be processed." }, { status: 502 });
  }
}
