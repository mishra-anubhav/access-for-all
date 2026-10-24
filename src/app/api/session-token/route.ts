import { NextResponse } from "next/server";
import { allowRequest, clientRateKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!allowRequest(clientRateKey(request, "transcription-token"), 8, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Live session starts are temporarily limited. Try again later." }, { status: 429 });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured on the server." }, { status: 503 });

  let body: { language?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Language hint is optional.
  }
  const languages = ["en", "hi", "es", "fr", "zh"];
  const language = languages.includes(body.language ?? "") ? body.language : undefined;
  const session = {
    type: "transcription",
    audio: {
      input: {
        format: { type: "audio/pcm", rate: 24000 },
        transcription: { model: "gpt-live-transcribe", ...(language ? { languages: [language] } : {}), delay: "low" },
        turn_detection: null,
      },
    },
  };

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 600 }, session }),
      signal: AbortSignal.timeout(12000),
    });
    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: payload?.error?.message || "Could not start live transcription." }, { status: response.status });
    }
    return NextResponse.json({ value: payload.value, expires_at: payload.expires_at }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not reach the transcription service. Check your network and try again." }, { status: 502 });
  }
}
