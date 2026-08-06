import { decryptJson, encryptJson } from "./crypto";
import type { BotCredentials, BotState, ConversationMessage } from "./types";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bot_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    encrypted_payload TEXT,
    is_logged_in INTEGER NOT NULL DEFAULT 0,
    last_poll_at TEXT,
    last_error TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_user_created
    ON conversations(from_user_id, created_at DESC, id DESC)`,
  `CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS login_qr (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    qrcode_key TEXT,
    qrcode_img TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS chat_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id TEXT NOT NULL UNIQUE,
    last_message_preview TEXT NOT NULL,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_candidates_seen
    ON chat_candidates(last_seen_at DESC, id DESC)`
];

let schemaInitialization: Promise<void> | undefined;

export const ensureSchema = async (db: D1Database): Promise<void> => {
  schemaInitialization ??= db.batch(SCHEMA.map((statement) => db.prepare(statement)))
    .then(() => undefined);
  try {
    await schemaInitialization;
  } catch (error) {
    schemaInitialization = undefined;
    throw error;
  }
};

interface BotStateRow {
  encrypted_payload: string | null;
  is_logged_in: number;
  last_poll_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export const getBotState = async (db: D1Database, secret: string): Promise<BotState> => {
  const row = await db.prepare(
    `SELECT encrypted_payload, is_logged_in, last_poll_at, last_error, updated_at
     FROM bot_state WHERE id = 1`
  ).first<BotStateRow>();

  if (!row) {
    return {
      credentials: null,
      isLoggedIn: false,
      lastPollAt: null,
      lastError: null,
      updatedAt: new Date(0).toISOString()
    };
  }

  return {
    credentials: row.encrypted_payload
      ? await decryptJson<BotCredentials>(secret, row.encrypted_payload)
      : null,
    isLoggedIn: row.is_logged_in === 1,
    lastPollAt: row.last_poll_at,
    lastError: row.last_error,
    updatedAt: row.updated_at
  };
};

export const saveBotCredentials = async (
  db: D1Database,
  secret: string,
  credentials: BotCredentials
): Promise<void> => {
  const encrypted = await encryptJson(secret, credentials);
  await db.prepare(
    `INSERT INTO bot_state (id, encrypted_payload, is_logged_in, last_error, updated_at)
     VALUES (1, ?, 1, NULL, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       encrypted_payload = excluded.encrypted_payload,
       is_logged_in = 1,
       last_error = NULL,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(encrypted).run();
};

export const updatePollingState = async (
  db: D1Database,
  secret: string,
  credentials: BotCredentials
): Promise<void> => {
  const encrypted = await encryptJson(secret, credentials);
  await db.prepare(
    `UPDATE bot_state SET encrypted_payload = ?, last_poll_at = CURRENT_TIMESTAMP,
     last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = 1`
  ).bind(encrypted).run();
};

export const markBotLoggedOut = async (db: D1Database, error: string): Promise<void> => {
  await db.prepare(
    `UPDATE bot_state SET is_logged_in = 0, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`
  ).bind(error).run();
};

export const setBotError = async (db: D1Database, error: string): Promise<void> => {
  await db.prepare(
    `UPDATE bot_state SET last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`
  ).bind(error).run();
};

interface LoginQrRecord {
  key: string;
  image: string;
  status: "pending" | "scanned" | "confirmed" | "expired";
}

interface LoginQrStatusRecord {
  key: string;
  status: LoginQrRecord["status"];
}

export const saveLoginQr = async (db: D1Database, record: LoginQrRecord): Promise<void> => {
  await db.prepare(
    `INSERT INTO login_qr (id, qrcode_key, qrcode_img, status, created_at, updated_at)
     VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET qrcode_key = excluded.qrcode_key,
       qrcode_img = excluded.qrcode_img, status = excluded.status,
       created_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`
  ).bind(record.key, record.image, record.status).run();
};

export const getLoginQr = async (db: D1Database): Promise<LoginQrStatusRecord | null> => {
  const row = await db.prepare(
    `SELECT qrcode_key, status FROM login_qr WHERE id = 1`
  ).first<{ qrcode_key: string | null; status: LoginQrRecord["status"] }>();
  if (!row?.qrcode_key) return null;
  return { key: row.qrcode_key, status: row.status };
};

export const updateLoginQrStatus = async (db: D1Database, status: LoginQrRecord["status"]): Promise<void> => {
  await db.prepare(
    `UPDATE login_qr SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`
  ).bind(status).run();
};

export const getConfigValue = async (db: D1Database, key: string): Promise<string | null> => {
  const row = await db.prepare(`SELECT value FROM config WHERE key = ?`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
};

export const setConfigValue = async (db: D1Database, key: string, value: string): Promise<void> => {
  await db.prepare(
    `INSERT INTO config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, value).run();
};

export const deleteConfigValue = async (db: D1Database, key: string): Promise<void> => {
  await db.prepare(`DELETE FROM config WHERE key = ?`).bind(key).run();
};

export const getConversationHistory = async (
  db: D1Database,
  fromUserId: string,
  limit = 20
): Promise<ConversationMessage[]> => {
  const result = await db.prepare(
    `SELECT role, content, created_at FROM conversations
     WHERE from_user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`
  ).bind(fromUserId, limit).all<{ role: "user" | "assistant"; content: string; created_at: string }>();

  return (result.results ?? []).reverse().map((row) => ({
    role: row.role,
    content: row.content,
    createdAt: row.created_at
  }));
};

export const addConversationMessage = async (
  db: D1Database,
  fromUserId: string,
  role: "user" | "assistant",
  content: string
): Promise<void> => {
  await db.prepare(
    `INSERT INTO conversations (from_user_id, role, content) VALUES (?, ?, ?)`
  ).bind(fromUserId, role, content).run();
};

interface ChatCandidate {
  id: number;
  fromUserId: string;
  lastMessagePreview: string;
  lastSeenAt: string;
}

export const upsertChatCandidate = async (
  db: D1Database,
  fromUserId: string,
  message: string
): Promise<void> => {
  const preview = message.replace(/\s+/g, " ").trim().slice(0, 80);
  await db.prepare(
    `INSERT INTO chat_candidates (from_user_id, last_message_preview, last_seen_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(from_user_id) DO UPDATE SET
       last_message_preview = excluded.last_message_preview,
       last_seen_at = CURRENT_TIMESTAMP`
  ).bind(fromUserId, preview).run();
};

export const listChatCandidates = async (db: D1Database): Promise<ChatCandidate[]> => {
  const result = await db.prepare(
    `SELECT id, from_user_id, last_message_preview, last_seen_at
     FROM chat_candidates ORDER BY last_seen_at DESC, id DESC LIMIT 50`
  ).all<{ id: number; from_user_id: string; last_message_preview: string; last_seen_at: string }>();

  return (result.results ?? []).map((row) => ({
    id: row.id,
    fromUserId: row.from_user_id,
    lastMessagePreview: row.last_message_preview,
    lastSeenAt: row.last_seen_at
  }));
};

export const getChatCandidateUserId = async (db: D1Database, id: number): Promise<string | null> => {
  const row = await db.prepare(
    `SELECT from_user_id FROM chat_candidates WHERE id = ?`
  ).bind(id).first<{ from_user_id: string }>();
  return row?.from_user_id ?? null;
};
