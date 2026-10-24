import { TrueForge } from "@truefoundry/trueforge-sdk";

export function getTrueForge() {
  const baseUrl = process.env.TRUEFORGE_BASE_URL || "http://localhost:8790";
  return new TrueForge({
    baseUrl,
    token: process.env.TRUEFORGE_TOKEN || undefined,
    timeoutInSeconds: 90,
  });
}

export async function getModelName() {
  if (process.env.TRUEFORGE_MODEL) return process.env.TRUEFORGE_MODEL;
  const { data } = await getTrueForge().models.list();
  const openAiModels = data.filter((model) => model.name.toLowerCase().startsWith("openai/"));
  const preferred = openAiModels.find((model) => /gpt-6\.1-sol/i.test(model.name));
  const selected = preferred ?? openAiModels[0] ?? data[0];
  if (!selected) throw new Error("No model is configured in TrueForge. Add an OpenAI model in Settings → Models.");
  return selected.name;
}

export function modelText(content: string | Array<{ type: string; text?: string }> | null | undefined) {
  if (typeof content === "string") return content;
  return content?.filter((part) => part.type === "text").map((part) => part.text || "").join("\n") || "";
}

export const ACCESS_FOR_ALL_INSTRUCTIONS = `You are AccessForAll, an accessibility companion for conference attendees. Help people understand, explore, remember, and act on spoken information. Be concise and kind. Ground claims about the speaker in retrieved transcript only. If the transcript does not support a claim, say so plainly and label any general context as general knowledge. Never invent a quotation or attribute information to the speaker unless it appears in the transcript. Respect the requested language and explanation level. For accommodation requests, check available event details, prepare a clear draft, and only call submit_approved_request when a human explicitly approves that tool call.`;
