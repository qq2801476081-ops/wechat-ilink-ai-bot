import { Hono } from "hono";
import * as QRCode from "qrcode";
import { generateAiReply } from "./ai";
import { getAllowedUserId, getPublicConfig, saveDynamicConfig, setAllowedUserId } from "./config";
import {
  addConversationMessage,
  ensureSchema,
  getBotState,
  getChatCandidate,
  getConversationHistory,
  getLoginQr,
  listChatCandidates,
  markBotLoggedOut,
  saveBotCredentials,
  saveLoginQr,
  setBotError,
  updateLoginQrStatus,
  updatePollingState,
  upsertChatCandidate
} from "./db";
import { extractText, IlinkApiError, IlinkClient } from "./ilink";
import { renderSetupPage } from "./setup.html.ts";
import type { Env } from "./types";

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const renderQrDataUrl = async (content: string): Promise<string> => {
  if (content.startsWith("data:image/")) return content;
  const svg = await QRCode.toString(content, {
    type: "svg",
    margin: 1,
    width: 320,
    errorCorrectionLevel: "M",
    color: { dark: "#17211b", light: "#ffffff" }
  });
  return `data:image/svg+xml;base64,${toBase64(new TextEncoder().encode(svg))}`;
};

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export const ERROR_REPLIES = [
  "哎呀脑子卡壳了😵 等我缓一下",
  "网有点卡，消息没发出去🤦",
  "刚才走神了，你再说一遍？",
  "服务器打瞌睡了💤 稍等哈",
  "哈？你说啥？我没听清😅"
] as const;

export const getErrorReply = (): string =>
  ERROR_REPLIES[Math.floor(Math.random() * ERROR_REPLIES.length)] ?? ERROR_REPLIES[0];

export const createApp = (): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();

  app.use("*", async (c, next) => {
    await ensureSchema(c.env.DB);
    await next();
  });

  app.onError((error, c) => {
    console.error("[http] request failed", error);
    const status = error instanceof SyntaxError ? 400 : 500;
    return c.json({ error: status === 400 ? "invalid_request" : "internal_error", message: errorMessage(error) }, status);
  });

  app.get("/", async (c) => {
    const state = await getBotState(c.env.DB, c.env.BOT_STATE_ENC_KEY);
    return c.html(`<!doctype html><meta charset="utf-8"><title>微信 AI 机器人</title><style>body{font:16px system-ui;max-width:680px;margin:60px auto;padding:0 20px;color:#17211b}a{color:#176b45}</style><h1>微信 AI 机器人</h1><p>状态：${state.isLoggedIn ? "已登录" : "未登录"}</p><p>上次轮询：${state.lastPollAt ?? "尚未轮询"}</p>${state.lastError ? `<p>最近错误：${state.lastError.replace(/[<>&]/g, "")}</p>` : ""}<p><a href="/setup">打开配置向导</a></p>`);
  });

  app.get("/setup", (c) => c.html(renderSetupPage(), 200, { "Cache-Control": "no-store" }));

  app.get("/health", async (c) => {
    const state = await getBotState(c.env.DB, c.env.BOT_STATE_ENC_KEY);
    return c.json({ ok: true, loggedIn: state.isLoggedIn, lastPollAt: state.lastPollAt, updatedAt: state.updatedAt });
  });

  app.get("/api/config", async (c) => c.json(await getPublicConfig(c.env)));

  app.post("/api/config", async (c) => {
    const input = await c.req.json<{ key?: unknown; value?: unknown }>();
    if (typeof input.key !== "string" || typeof input.value !== "string") {
      return c.json({ error: "invalid_config", message: "Body 必须包含字符串 key 和 value" }, 400);
    }
    try {
      await saveDynamicConfig(c.env, input.key, input.value);
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: "invalid_config", message: errorMessage(error) }, 400);
    }
  });

  app.get("/api/chat-binding", async (c) => {
    const [candidates, allowedUserId] = await Promise.all([
      listChatCandidates(c.env.DB),
      getAllowedUserId(c.env)
    ]);
    return c.json({
      selectedCandidateId: candidates.find((candidate) => candidate.fromUserId === allowedUserId)?.id ?? null,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        lastMessagePreview: candidate.lastMessagePreview,
        lastSeenAt: candidate.lastSeenAt
      }))
    });
  });

  app.post("/api/chat-binding", async (c) => {
    const input = await c.req.json<{ candidateId?: unknown }>();
    if (input.candidateId === null) {
      await setAllowedUserId(c.env, null);
      return c.json({ ok: true, selectedCandidateId: null });
    }
    if (!Number.isInteger(input.candidateId) || Number(input.candidateId) <= 0) {
      return c.json({ error: "invalid_candidate", message: "请选择有效的候选好友" }, 400);
    }
    const candidate = await getChatCandidate(c.env.DB, Number(input.candidateId));
    if (!candidate) return c.json({ error: "candidate_not_found", message: "候选好友不存在，请刷新列表" }, 404);
    await setAllowedUserId(c.env, candidate.fromUserId);
    return c.json({ ok: true, selectedCandidateId: candidate.id });
  });

  app.get("/api/login/qr", async (c) => {
    const client = new IlinkClient(c.env.ILINK_BASE_URL);
    const qr = await client.getBotQrcode();
    const image = await renderQrDataUrl(qr.content);
    await saveLoginQr(c.env.DB, { key: qr.key, image, status: "pending" });
    return c.json({ key: qr.key, imgBase64: image });
  });

  app.get("/api/login/status", async (c) => {
    const key = c.req.query("key")?.trim();
    if (!key) return c.json({ error: "missing_key", message: "缺少二维码 key" }, 400);
    const record = await getLoginQr(c.env.DB);
    if (!record || record.key !== key) return c.json({ error: "qr_not_found", message: "二维码不存在或已被替换" }, 404);
    if (record.status === "confirmed" || record.status === "expired") return c.json({ status: record.status });

    const client = new IlinkClient(c.env.ILINK_BASE_URL);
    const result = await client.getQrcodeStatus(key);
    await updateLoginQrStatus(c.env.DB, result.status === "wait" ? "pending" : result.status);

    if (result.status === "confirmed") {
      if (!result.botToken || !result.accountId || !result.userId) {
        throw new Error("iLink confirmed login without complete credentials");
      }
      await saveBotCredentials(c.env.DB, c.env.BOT_STATE_ENC_KEY, {
        botToken: result.botToken,
        accountId: result.accountId,
        userId: result.userId,
        baseUrl: result.baseUrl || c.env.ILINK_BASE_URL || "https://ilinkai.weixin.qq.com",
        getUpdatesBuf: ""
      });
    }

    return c.json({ status: result.status });
  });

  return app;
};

interface ScheduledClient {
  getUpdates(token: string, buffer: string, timeoutMs?: number): Promise<{ buffer: string; messages: import("./ilink").IlinkMessage[] }>;
  sendTyping(token: string, userId: string, contextToken: string): Promise<void>;
  sendTextMessage(token: string, toUserId: string, text: string, contextToken: string): Promise<void>;
}

export interface ScheduledDependencies {
  createClient(baseUrl: string): ScheduledClient;
  generateReply(
    env: Env,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    userText: string
  ): Promise<string>;
}

const defaultScheduledDependencies: ScheduledDependencies = {
  createClient: (baseUrl) => new IlinkClient(baseUrl),
  generateReply: generateAiReply
};

export const handleScheduled = async (
  env: Env,
  dependencies: ScheduledDependencies = defaultScheduledDependencies,
  pollTimeoutMs = 35_000
): Promise<{ polled: boolean; hasMessages: boolean }> => {
  await ensureSchema(env.DB);
  const state = await getBotState(env.DB, env.BOT_STATE_ENC_KEY);
  if (!state.isLoggedIn || !state.credentials) return { polled: false, hasMessages: false };

  const credentials = { ...state.credentials };
  const client = dependencies.createClient(credentials.baseUrl || env.ILINK_BASE_URL || "https://ilinkai.weixin.qq.com");

  try {
    const updates = await client.getUpdates(credentials.botToken, credentials.getUpdatesBuf, pollTimeoutMs);
    credentials.getUpdatesBuf = updates.buffer;
    await updatePollingState(env.DB, env.BOT_STATE_ENC_KEY, credentials);
    const allowedUserId = await getAllowedUserId(env);

    for (const message of updates.messages) {
      if (message.message_type !== undefined && message.message_type !== 1) continue;
      const fromUserId = message.from_user_id?.trim();
      const contextToken = message.context_token?.trim();
      const text = extractText(message).trim();
      if (!fromUserId || !contextToken || !text) continue;

      const isAllowedUser = Boolean(allowedUserId && fromUserId === allowedUserId);
      if (isAllowedUser) {
        credentials.latestContextToken = contextToken;
        try {
          await client.sendTyping(credentials.botToken, fromUserId, contextToken);
        } catch (error) {
          if (error instanceof IlinkApiError && error.requiresLogin) throw error;
          console.warn("[scheduled] sendtyping failed", errorMessage(error));
        }
      }

      await upsertChatCandidate(env.DB, fromUserId, text);
      if (!isAllowedUser) continue;

      const history = await getConversationHistory(env.DB, fromUserId, 20);
      let reply: string;
      try {
        reply = await dependencies.generateReply(env, history.map(({ role, content }) => ({ role, content })), text);
      } catch (error) {
        console.error("[scheduled] AI call failed", errorMessage(error));
        reply = getErrorReply();
      }

      await addConversationMessage(env.DB, fromUserId, "user", text);
      await addConversationMessage(env.DB, fromUserId, "assistant", reply);
      await client.sendTextMessage(credentials.botToken, fromUserId, reply, contextToken);
    }

    await updatePollingState(env.DB, env.BOT_STATE_ENC_KEY, credentials);
    return { polled: true, hasMessages: updates.messages.length > 0 };
  } catch (error) {
    const message = errorMessage(error);
    if (error instanceof IlinkApiError && error.requiresLogin) {
      await markBotLoggedOut(env.DB, message);
      return { polled: false, hasMessages: false };
    }
    await setBotError(env.DB, message);
    throw error;
  }
};

const MAX_SCHEDULED_DURATION_MS = 55_000;
const MAX_LONG_POLL_MS = 35_000;
const LOOP_SAFETY_MARGIN_MS = 500;

export const handleScheduledLoop = async (
  env: Env,
  dependencies: ScheduledDependencies = defaultScheduledDependencies
): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < MAX_SCHEDULED_DURATION_MS) {
    const remaining = MAX_SCHEDULED_DURATION_MS - (Date.now() - startedAt);
    const pollTimeoutMs = Math.min(MAX_LONG_POLL_MS, remaining - LOOP_SAFETY_MARGIN_MS);
    if (pollTimeoutMs <= 0) break;

    try {
      const result = await handleScheduled(env, dependencies, pollTimeoutMs);
      if (!result.polled) break;
    } catch (error) {
      console.error("Poll error:", error);
      const retryDelay = Math.min(3_000, MAX_SCHEDULED_DURATION_MS - (Date.now() - startedAt));
      if (retryDelay <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
};

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx): void {
    ctx.waitUntil(handleScheduledLoop(env));
  }
} satisfies ExportedHandler<Env>;
