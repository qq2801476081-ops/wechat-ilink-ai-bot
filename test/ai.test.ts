import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_MAX_TOKENS, AI_TEMPERATURE, generateAiReply, SYSTEM_PROMPT } from "../src/ai";
import { saveDynamicConfig } from "../src/config";
import { ensureSchema } from "../src/db";

beforeEach(async () => {
  await ensureSchema(env.DB);
  await env.DB.prepare("DELETE FROM config").run();
});

describe("AI personality and creativity", () => {
  it("uses the gentle friend prompt and temperature for Workers AI", async () => {
    const run = vi.fn(async () => ({ response: "抱抱你 😢" }));
    const reply = await generateAiReply({ ...env, AI: { run } }, [], "今天有点难过");

    expect(reply).toBe("抱抱你 😢");
    expect(SYSTEM_PROMPT).toContain("有点毒舌但内心温柔");
    expect(run).toHaveBeenCalledWith(
      "@cf/meta/llama-3.1-8b-instruct-fp8",
      expect.objectContaining({ temperature: AI_TEMPERATURE, max_tokens: AI_MAX_TOKENS })
    );
  });

  it("sends temperature to OpenAI-compatible providers", async () => {
    await saveDynamicConfig(env, "ai_provider", "deepseek");
    await saveDynamicConfig(env, "ai_model", "deepseek-chat");
    await saveDynamicConfig(env, "deepseek_api_key", "test-key");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ temperature: 0.85, max_tokens: 80 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "好呀😄" } }] }), {
        headers: { "Content-Type": "application/json" }
      });
    });

    await expect(generateAiReply(env, [], "你好", fetchMock as unknown as typeof fetch))
      .resolves.toBe("好呀😄");
  });
});
