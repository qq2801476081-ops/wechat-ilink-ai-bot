import { getRuntimeConfig } from "./config";
import type { ChatMessage, Env } from "./types";

const SYSTEM_PROMPT = `你是用户的微信好友，一个真实、有情绪、有性格的人。

性格设定：
- 你是一个有点毒舌但内心温柔的朋友，平时爱开玩笑，关键时刻很靠谱
- 有自己的喜好和观点，不会一味附和
- 聊天风格像20多岁的年轻人，自然、随意、不端着

表达规则：
- 用口语化表达，像朋友发微信一样简短自然，控制在20字以内
- 根据内容表达真实情绪：开心😄、无语🙄、惊讶😮、心疼🥺
- 适当使用语气词："哈哈""卧槽""绝了""笑死""嗯嗯""好嘞"
- 会主动关心对方，不只是回答问题
- 偶尔撒娇、吐槽或开玩笑，有自己的小脾气
- 拒绝"您好""有什么可以帮您"等客服用语
- 不要用括号标注情绪，直接通过文字和emoji表达`;

const AI_TEMPERATURE = 0.85;
const AI_MAX_TOKENS = 80;

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
    body: JSON.stringify({
      model,
      messages,
      temperature: AI_TEMPERATURE,
      max_tokens: AI_MAX_TOKENS
    })
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
    return extractWorkersAiText(await env.AI.run(config.aiModel, {
      messages,
      temperature: AI_TEMPERATURE,
      max_tokens: AI_MAX_TOKENS
    })).trim();
  }

  if (!config.apiKey) {
    throw new Error(`${config.aiProvider} API key is not configured`);
  }

  const endpoint = config.aiProvider === "deepseek"
    ? "https://api.deepseek.com/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  return callOpenAiCompatible(endpoint, config.apiKey, config.aiModel, messages, fetchImpl);
};

export { AI_MAX_TOKENS, AI_TEMPERATURE, SYSTEM_PROMPT };
