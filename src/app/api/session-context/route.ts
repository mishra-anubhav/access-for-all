import { NextResponse } from "next/server";
import { setSessionContext } from "@/lib/transcript-store";

export const runtime = "nodejs";
const allowed = new Set(["en", "hi", "es", "fr", "zh"]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.sessionId !== "string" || !/^[a-zA-Z0-9_-]{12,80}$/.test(body.sessionId)) {
    return NextResponse.json({ error: "Invalid session identifier." }, { status: 400 });
  }
  if (!Array.isArray(body.segments) || body.segments.length > 120) {
    return NextResponse.json({ error: "Transcript context is limited to 120 segments." }, { status: 413 });
  }
  const segments = body.segments
    .filter((segment: unknown): segment is { id: string; text: string; createdAt: number; translation?: string } =>
      typeof segment === "object" && segment !== null &&
      typeof (segment as { id?: unknown }).id === "string" &&
      typeof (segment as { text?: unknown }).text === "string" &&
      typeof (segment as { createdAt?: unknown }).createdAt === "number")
    .map((segment: { id: string; text: string; createdAt: number; translation?: string }) => ({
      id: segment.id.slice(0, 100), text: segment.text.slice(0, 1800), createdAt: segment.createdAt,
      ...(typeof segment.translation === "string" ? { translation: segment.translation.slice(0, 1800) } : {}),
    }));
  const language = allowed.has(body.preferences?.language) ? body.preferences.language : "en";
  const level = ["beginner", "intermediate", "advanced"].includes(body.preferences?.level) ? body.preferences.level : "beginner";
  setSessionContext(body.sessionId, { segments, preferences: { language, level } });
  return NextResponse.json({ ok: true, count: segments.length });
}
