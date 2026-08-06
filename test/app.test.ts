import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSchema, getBotState, saveBotCredentials, upsertChatCandidate } from "../src/db";
import { handleScheduled, handleScheduledLoop, type ScheduledDependencies } from "../src/index";
import { IlinkApiError } from "../src/ilink";
import { setAllowedUserId } from "../src/config";

const resetDatabase = async (): Promise<void> => {
  await ensureSchema(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM conversations"),
    env.DB.prepare("DELETE FROM chat_candidates"),
    env.DB.prepare("DELETE FROM config"),
    env.DB.prepare("DELETE FROM login_qr"),
    env.DB.prepare("DELETE FROM bot_state")
  ]);
};

beforeEach(resetDatabase);

describe("HTTP routes", () => {
  it("serves setup and health after automatic schema initialization", async () => {
    const setup = await SELF.fetch("https://worker.test/setup");
    expect(setup.status).toBe(200);
    expect(await setup.text()).toContain("微信 AI 机器人");

    const health = await SELF.fetch("https://worker.test/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, loggedIn: false });
  });

  it("saves public configuration and never echoes an API key", async () => {
    const secret = "sk-secret-value";
    const save = await SELF.fetch("https://worker.test/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "deepseek_api_key", value: secret })
    });
    expect(save.status).toBe(200);

    const response = await SELF.fetch("https://worker.test/api/config");
    const body = await response.json<Record<string, unknown>>();
    expect(body.deepseek_api_key_configured).toBe(true);
    expect(JSON.stringify(body)).not.toContain(secret);

    const row = await env.DB.prepare("SELECT value FROM config WHERE key = ?")
      .bind("deepseek_api_key").first<{ value: string }>();
    expect(row?.value).not.toContain(secret);
  });

  it("lists message candidates and binds one without exposing its user id", async () => {
    await upsertChatCandidate(env.DB, "private-user-id", "我是需要绑定的好友");

    const listResponse = await SELF.fetch("https://worker.test/api/chat-binding");
    const list = await listResponse.json<{ candidates: Array<{ id: number; lastMessagePreview: string }>; selectedCandidateId: number | null }>();
    expect(list.candidates).toHaveLength(1);
    expect(list.candidates[0]?.lastMessagePreview).toBe("我是需要绑定的好友");
    expect(JSON.stringify(list)).not.toContain("private-user-id");

    const bind = await SELF.fetch("https://worker.test/api/chat-binding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: list.candidates[0]?.id })
    });
    expect(bind.status).toBe(200);

    const selected = await (await SELF.fetch("https://worker.test/api/chat-binding"))
      .json<{ selectedCandidateId: number | null }>();
    expect(selected.selectedCandidateId).toBe(list.candidates[0]?.id);
    const stored = await env.DB.prepare("SELECT value FROM config WHERE key = 'allowed_user_id'")
      .first<{ value: string }>();
    expect(stored?.value).not.toContain("private-user-id");
  });
});

describe("scheduled conversation processing", () => {
  it("records candidates but replies only to the selected friend", async () => {
    await saveBotCredentials(env.DB, env.BOT_STATE_ENC_KEY, {
      botToken: "plain-bot-token",
      accountId: "account",
      userId: "bot-user",
      baseUrl: "https://ilink.test",
      getUpdatesBuf: "old"
    });
    await setAllowedUserId(env, "user-a");

    const sent: Array<{ user: string; text: string; context: string }> = [];
    const events: string[] = [];
    const client = {
      getUpdates: vi.fn(async () => ({
        buffer: "new",
        messages: [
          { message_type: 1, from_user_id: "user-a", context_token: "ctx-a", item_list: [{ type: 1, text_item: { text: "A question" } }] },
          { message_type: 1, from_user_id: "user-b", context_token: "ctx-b", item_list: [{ type: 1, text_item: { text: "B question" } }] }
        ]
      })),
      sendTyping: vi.fn(async (_token: string, user: string) => { events.push(`typing:${user}`); }),
      sendTextMessage: vi.fn(async (_token: string, user: string, text: string, context: string) => {
        sent.push({ user, text, context });
      })
    };
    const seenHistories: Array<{ text: string; size: number }> = [];
    const dependencies: ScheduledDependencies = {
      createClient: () => client,
      generateReply: vi.fn(async (_runtimeEnv, history, text) => {
        events.push(`ai:${text}`);
        seenHistories.push({ text, size: history.length });
        return `reply:${text}`;
      })
    };

    await handleScheduled(env, dependencies);

    expect(sent).toEqual([
      { user: "user-a", text: "reply:A question", context: "ctx-a" }
    ]);
    expect(seenHistories).toEqual([{ text: "A question", size: 0 }]);
    expect(events).toEqual(["typing:user-a", "ai:A question"]);
    const counts = await env.DB.prepare(
      "SELECT from_user_id, COUNT(*) AS count FROM conversations GROUP BY from_user_id ORDER BY from_user_id"
    ).all<{ from_user_id: string; count: number }>();
    expect(counts.results).toEqual([
      { from_user_id: "user-a", count: 2 }
    ]);
    const candidates = await env.DB.prepare(
      "SELECT from_user_id FROM chat_candidates ORDER BY from_user_id"
    ).all<{ from_user_id: string }>();
    expect(candidates.results).toEqual([{ from_user_id: "user-a" }, { from_user_id: "user-b" }]);

    const state = await getBotState(env.DB, env.BOT_STATE_ENC_KEY);
    expect(state.credentials?.getUpdatesBuf).toBe("new");
    const raw = await env.DB.prepare("SELECT encrypted_payload FROM bot_state WHERE id = 1")
      .first<{ encrypted_payload: string }>();
    expect(raw?.encrypted_payload).not.toContain("plain-bot-token");
  });

  it("marks the bot logged out after an expired iLink session", async () => {
    await saveBotCredentials(env.DB, env.BOT_STATE_ENC_KEY, {
      botToken: "token",
      accountId: "account",
      userId: "bot-user",
      baseUrl: "https://ilink.test",
      getUpdatesBuf: ""
    });
    const dependencies: ScheduledDependencies = {
      createClient: () => ({
        getUpdates: async () => { throw new IlinkApiError("expired", 401, 0, -14); },
        sendTyping: async () => undefined,
        sendTextMessage: async () => undefined
      }),
      generateReply: async () => "unused"
    };

    await handleScheduled(env, dependencies);
    expect((await getBotState(env.DB, env.BOT_STATE_ENC_KEY)).isLoggedIn).toBe(false);
  });

  it("loops long polling within the 55 second safety window", async () => {
    await saveBotCredentials(env.DB, env.BOT_STATE_ENC_KEY, {
      botToken: "token",
      accountId: "account",
      userId: "bot-user",
      baseUrl: "https://ilink.test",
      getUpdatesBuf: ""
    });
    const timeouts: number[] = [];
    const dependencies: ScheduledDependencies = {
      createClient: () => ({
        getUpdates: async (_token, buffer, timeoutMs = 0) => {
          timeouts.push(timeoutMs);
          vi.setSystemTime(Date.now() + timeoutMs);
          return { buffer, messages: [] };
        },
        sendTyping: async () => undefined,
        sendTextMessage: async () => undefined
      }),
      generateReply: async () => "unused"
    };

    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      await handleScheduledLoop(env, dependencies);
    } finally {
      vi.useRealTimers();
    }

    expect(timeouts).toEqual([35_000, 19_500]);
  });
});
