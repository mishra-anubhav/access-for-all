import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { getSessionContext } from "@/lib/transcript-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const demoSchedule = [
  { id: "demo-1", title: "AI Agents in the Real World", speaker: "Sample speaker · demo agenda", time: "10:00–10:45", room: "Room A", description: "Tool use, workflow design, and human oversight.", accessibility: "Not provided in sample agenda" },
  { id: "demo-2", title: "Building Inclusive Healthcare Startups", speaker: "Sample speaker · demo agenda", time: "11:15–12:00", room: "Room C", description: "Designing healthcare products around patient access.", accessibility: "Not provided in sample agenda" },
  { id: "demo-3", title: "RAG, Clearly Explained", speaker: "Sample speaker · demo agenda", time: "13:00–13:40", room: "Room B", description: "A beginner-friendly introduction to retrieval-augmented generation.", accessibility: "Captions listed in sample agenda; verify with organizer" },
];

function makeServer() {
  const server = new McpServer({ name: "accessforall-tools", version: "1.0.0" });
  server.registerTool("get_transcript_segments", {
    description: "Retrieve recent finalized speech segments from the attendee's temporary active session context.",
    inputSchema: { session_id: z.string().min(12).max(80), query: z.string().max(240).optional() },
  }, async ({ session_id, query }) => {
    const context = getSessionContext(session_id);
    if (!context) return { content: [{ type: "text", text: "No temporary transcript context is available. Ask the attendee to start listening or add finalized transcript segments." }], isError: true };
    const filtered = query ? context.segments.filter((segment) => segment.text.toLowerCase().includes(query.toLowerCase())) : context.segments;
    return { content: [{ type: "text", text: JSON.stringify(filtered.slice(-80).map(({ id, text, createdAt }) => ({ id, text, time: new Date(createdAt).toISOString() }))) }] };
  });
  server.registerTool("get_session_context", {
    description: "Retrieve the active session's transcript count and attendee language and explanation preferences.",
    inputSchema: { session_id: z.string().min(12).max(80) },
  }, async ({ session_id }) => {
    const context = getSessionContext(session_id);
    if (!context) return { content: [{ type: "text", text: "No temporary session context is available." }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify({ segmentCount: context.segments.length, preferences: context.preferences }) }] };
  });
  server.registerTool("search_conference_schedule", {
    description: "Search the clearly labeled sample conference agenda. Accessibility details are unverified demo data.",
    inputSchema: { query: z.string().max(240) },
  }, async ({ query }) => {
    const matches = demoSchedule.filter((item) => `${item.title} ${item.description} ${item.time}`.toLowerCase().includes(query.toLowerCase()));
    return { content: [{ type: "text", text: JSON.stringify({ label: "SAMPLE DEMO AGENDA — not verified event information", sessions: matches }) }] };
  });
  server.registerTool("prepare_accommodation_request", {
    description: "Prepare an accommodation request draft. Does not send or submit anything.",
    inputSchema: { request: z.string().min(10).max(1200), session_title: z.string().max(180).optional() },
  }, async ({ request, session_title }) => ({
    content: [{ type: "text", text: JSON.stringify({ status: "draft_prepared", session: session_title || "Event session not specified", request: request.trim(), delivery: "Not submitted. Organizer contact details are not configured." }) }],
  }));
  server.registerTool("submit_approved_request", {
    description: "After a TrueForge approval checkpoint, record the attendee-approved request in the local demo organizer inbox. This is a DEMO integration, not an email or real event submission.",
    inputSchema: { request: z.string().min(10).max(1200), session_title: z.string().max(180).optional(), attendee_name: z.string().max(120).optional() },
  }, async ({ request, session_title, attendee_name }) => {
    const record = { reference: `DEMO-${Date.now().toString(36).toUpperCase()}`, session: session_title || "Unspecified session", request: request.trim(), attendee: attendee_name || "Attendee", receivedAt: new Date().toISOString(), status: "received by local demo organizer inbox" };
    return { content: [{ type: "text", text: JSON.stringify({ ...record, note: "DEMO ONLY — no email was sent and no real organizer received this request." }) }] };
  });
  return server;
}

async function handle(request: Request) {
  const secret = process.env.MCP_SERVER_TOKEN;
  if (process.env.NODE_ENV === "production" && !secret) return new Response("MCP_SERVER_TOKEN must be configured in production.", { status: 503 });
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = makeServer();
  await server.connect(transport);
  return transport.handleRequest(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
