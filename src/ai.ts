import { getRuntimeConfig } from "./config";
import type { ChatMessage, Env } from "./types";

const SYSTEM_PROMPT = "你是一个友好的微信AI助手，回复简洁自然。";

const extractWorkersAiText = (response: unknown): string => {
  if (typeof response === "string") return response;
  if (response && typeof response === "object") {
    const value = (response as { response?: unknown }).response;
    if (typeof value === "string") return value;
  }
  throw new Error("Workers AI returned an unsupported response shape");
};

const callOpenAiCompatible = async (
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  fetchImpl: typeof fetch
): Promise<string> => {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model, messages })
  });

  const body = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.message || `AI API returned HTTP ${response.status}`);
  }

  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("AI API returned an empty response");
  return text;
};

export const generateAiReply = async (
  env: Env,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userText: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> => {
  const config = await getRuntimeConfig(env);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userText }
  ];

  if (config.aiProvider === "workers-ai") {
    return extractWorkersAiText(await env.AI.run(config.aiModel, { messages })).trim();
  }

  if (!config.apiKey) {
    throw new Error(`${config.aiProvider} API key is not configured`);
  }

  const endpoint = config.aiProvider === "deepseek"
    ? "https://api.deepseek.com/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  return callOpenAiCompatible(endpoint, config.apiKey, config.aiModel, messages, fetchImpl);
};

export { SYSTEM_PROMPT };
