export type AiProvider = "workers-ai" | "deepseek" | "openai";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface WorkersAiBinding {
  run(model: string, input: { messages: ChatMessage[]; temperature?: number; max_tokens?: number }): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  AI: WorkersAiBinding;
  BOT_STATE_ENC_KEY: string;
  DEEPSEEK_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ILINK_BASE_URL?: string;
}

export interface BotCredentials {
  botToken: string;
  accountId: string;
  userId: string;
  baseUrl: string;
  getUpdatesBuf: string;
  latestContextToken?: string;
}

export interface BotState {
  credentials: BotCredentials | null;
  isLoggedIn: boolean;
  lastPollAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface RuntimeConfig {
  aiProvider: AiProvider;
  aiModel: string;
  apiKey?: string;
}
