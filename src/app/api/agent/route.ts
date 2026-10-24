import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { addApproval } from "@/lib/approvals";
import { ACCESS_FOR_ALL_INSTRUCTIONS, getModelName, getTrueForge, modelText } from "@/lib/trueforge";
import { isEventDelta, mergeEventDelta, TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { allowRequest, clientRateKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

type Action = "qa" | "simplify" | "translate" | "notes" | "recommend" | "accommodation";
const actionInstructions: Record<Action, string> = {
  qa: "Answer the attendee's question using get_transcript_segments and get_session_context first. Provide a short answer, say what was or was not discussed, and cite timestamp ranges or segment times where available. Label general context separately.",
  simplify: "Explain the selected or recent transcript in the chosen language and level. Include one analogy, key terms, and a short example only if useful.",
  translate: "Translate the transcript segment faithfully into the selected language. Preserve technical terms in parentheses when useful. Output only the translation.",
  notes: "Create structured Markdown with Session Summary, Key Takeaways, Concepts Explained, Action Items (mark explicit speaker commitments separately from AI suggestions), and Questions to Explore.",
  recommend: "Recommend schedule items that match the attendee's interests, accessibility preferences, available time, language, and explanation level. Use search_conference_schedule. Clearly label the agenda as sample demo data, and explain missing accessibility details.",
  accommodation: "Understand the requested accommodation, retrieve event context, and prepare a clear request. Show the draft before submission. Then call submit_approved_request only for a request the user explicitly asked to make; this call is approval-gated by TrueForge and must never be bypassed.",
};

export async function POST(request: Request) {
  if (!allowRequest(clientRateKey(request, "agent"), 180, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "AI requests are temporarily limited. Try again later." }, { status: 429 });
  }
  const body = await request.json().catch(() => null);
  const actions: Action[] = ["qa", "simplify", "translate", "notes", "recommend", "accommodation"];
  if (!body || !actions.includes(body.action)) return NextResponse.json({ error: "Choose a supported AccessForAll workflow." }, { status: 400 });
  if (typeof body.prompt !== "string" || body.prompt.length > 7000) return NextResponse.json({ error: "The request must be under 7,000 characters." }, { status: 400 });

  const action = body.action as Action;
  const agentNeedsTools = ["qa", "recommend", "accommodation"].includes(action);
  const mcpName = process.env.TRUEFORGE_MCP_SERVER || "accessforall-tools";

  try {
    const client = getTrueForge();
    if (agentNeedsTools) await ensureMcpConnector(client, mcpName!);
    const modelName = await getModelName();
    const mcpServers = agentNeedsTools ? [{
      name: mcpName!,
      enableTools: ["get_transcript_segments", "get_session_context", "search_conference_schedule", "prepare_accommodation_request", "submit_approved_request"],
      requireApprovalForTools: ["submit_approved_request"],
      preloadTools: action === "qa" ? ["get_transcript_segments", "get_session_context"] : [],
    }] : [];
    const { data: session } = await client.sessions.create({ agent: { spec: {
      model: { name: modelName, params: { reasoning_effort: "medium" } },
      instructions: `${ACCESS_FOR_ALL_INSTRUCTIONS}\n\nCurrent workflow: ${actionInstructions[action]}\nUser language: ${String(body.language || "English").slice(0, 40)}. Explanation level: ${String(body.level || "beginner").slice(0, 20)}. Temporary transcript id: ${String(body.contextId || "").slice(0, 80)}.`,
      mcpServers,
    } } });
    const stream = await client.sessions.createTurnStream(session.id, {
      input: [{ type: "user.message", content: body.prompt }],
    });
    const eventIndex = new Map<string, TrueForgeApi.TurnStreamingEvent>();
    const trace: Array<{ type: string; label: string; status: string }> = [];
    const pending: Array<{ threadId: string; toolCallId: string; sourceEventId: string }> = [];
    let answer = "";
    let terminalError = "";

    for await (const { data: event } of stream.withMetadata()) {
      if (isEventDelta(event)) {
        const base = eventIndex.get(event.id);
        if (base) mergeEventDelta(base, event);
      } else if ("id" in event && typeof event.id === "string") eventIndex.set(event.id, event);
      if (event.type === "turn.created") trace.push({ type: event.type, label: "TrueForge agent started", status: "complete" });
      if (event.type === "mcp.initialize") trace.push({ type: event.type, label: "Accessibility tools connected", status: "complete" });
      if (event.type === "model.message" && event.toolCalls?.length) {
        for (const call of event.toolCalls) trace.push({ type: "tool.call", label: `Tool call · ${call.toolInfo.name}`, status: "complete" });
      }
      if (event.type === "tool.approval_required") {
        trace.push({ type: event.type, label: "Human approval required", status: "waiting" });
        for (const ref of event.toolCalls) pending.push({ threadId: event.threadId, toolCallId: ref.id, sourceEventId: ref.sourceEventId });
      }
      if (event.type === "tool.response") trace.push({ type: event.type, label: "Tool completed", status: "complete" });
      if (event.type === "turn.done") {
        if (event.state.status === "done") {
          if (event.state.output?.type === "model.message") answer = modelText(event.state.output.content);
          if (event.state.requiredActions.length === 0) trace.push({ type: event.type, label: "Agent response ready", status: "complete" });
        }
        if (event.state.status === "error") terminalError = event.state.message || "TrueForge run failed.";
      }
    }

    const approval = pending.map((item) => {
      const source = eventIndex.get(item.sourceEventId);
      const call = source?.type === "model.message" ? source.toolCalls?.find((candidate) => candidate.id === item.toolCallId) : undefined;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call?.function.arguments || "{}"); } catch { /* display safe empty details */ }
      const key = randomUUID();
      addApproval(key, { sessionId: session.id, threadId: item.threadId, toolCallId: item.toolCallId, args });
      return { key, tool: call?.toolInfo?.name || "approval-required", args };
    });
    if (terminalError) return NextResponse.json({ error: terminalError, trace }, { status: 502 });
    return NextResponse.json({ answer, trace, approval: approval[0] ?? null, sessionId: session.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TrueForge could not complete this workflow.";
    if (/Outbound URL blocked for host [\"']?localhost/i.test(message)) {
      return NextResponse.json({ error: 'TrueForge network policy blocked the local AccessForAll MCP connector. For a local demo, review and set OUTBOUND_URL_ALLOWED_HOSTS=["localhost"] in TrueForge, then restart it. This grants TrueForge connectors access to loopback services.' }, { status: 503 });
    }
    return NextResponse.json({ error: message.slice(0, 500) }, { status: 502 });
  }
}

async function ensureMcpConnector(client: ReturnType<typeof getTrueForge>, name: string) {
  const appBase = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const url = process.env.TRUEFORGE_MCP_URL || `${appBase}/api/mcp`;
  const { data } = await client.settings.mcpServers.list();
  const existing = data.find((server) => server.name === name);
  if (existing) {
    if (existing.manifest.type !== "remote" || existing.manifest.url !== url) {
      throw new Error(`TrueForge already has an MCP connector named “${name}” with a different URL. Set TRUEFORGE_MCP_SERVER to a new connector name or update its URL in TrueForge Settings.`);
    }
    return;
  }
  await client.settings.mcpServers.create({ manifest: {
    name,
    type: "remote",
    url,
    description: "AccessForAll live transcript retrieval, sample conference agenda, and human-approved demo accommodation actions.",
    ...(process.env.MCP_SERVER_TOKEN ? { auth: { type: "header" as const, headers: { Authorization: `Bearer ${process.env.MCP_SERVER_TOKEN}` } } } : {}),
  } });
}
