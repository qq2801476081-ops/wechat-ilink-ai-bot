import { decryptText, encryptText } from "./crypto";
import { deleteConfigValue, getConfigValue, setConfigValue } from "./db";
import type { AiProvider, Env, RuntimeConfig } from "./types";

const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
const DEFAULT_PROVIDER: AiProvider = "workers-ai";

const PROVIDERS = new Set<AiProvider>(["workers-ai", "deepseek", "openai"]);
const SECRET_CONFIG_KEYS = new Set(["deepseek_api_key", "openai_api_key"]);
const CONFIG_KEYS = new Set(["ai_provider", "ai_model", ...SECRET_CONFIG_KEYS]);

const isConfigKey = (key: string): boolean => CONFIG_KEYS.has(key);
const isSecretConfigKey = (key: string): boolean => SECRET_CONFIG_KEYS.has(key);

export const saveDynamicConfig = async (env: Env, key: string, value: string): Promise<void> => {
  if (!isConfigKey(key)) throw new Error("Unsupported config key");

  const normalized = value.trim();
  if (key === "ai_provider" && !PROVIDERS.has(normalized as AiProvider)) {
    throw new Error("Unsupported AI provider");
  }
  if (key === "ai_model" && !normalized) throw new Error("AI model cannot be empty");

  if (isSecretConfigKey(key)) {
    if (!normalized) {
      await deleteConfigValue(env.DB, key);
      return;
    }
    await setConfigValue(env.DB, key, await encryptText(env.BOT_STATE_ENC_KEY, normalized));
    return;
  }

  await setConfigValue(env.DB, key, normalized);
};

const getStoredSecret = async (env: Env, key: string): Promise<string | undefined> => {
  const encrypted = await getConfigValue(env.DB, key);
  return encrypted ? await decryptText(env.BOT_STATE_ENC_KEY, encrypted) : undefined;
};

export const getPublicConfig = async (env: Env): Promise<Record<string, string | boolean>> => {
  const [storedProvider, storedModel, storedDeepSeek, storedOpenAi] = await Promise.all([
    getConfigValue(env.DB, "ai_provider"),
    getConfigValue(env.DB, "ai_model"),
    getConfigValue(env.DB, "deepseek_api_key"),
    getConfigValue(env.DB, "openai_api_key")
  ]);

  return {
    ai_provider: storedProvider ?? DEFAULT_PROVIDER,
    ai_model: storedModel ?? DEFAULT_MODEL,
    deepseek_api_key_configured: Boolean(env.DEEPSEEK_API_KEY || storedDeepSeek),
    openai_api_key_configured: Boolean(env.OPENAI_API_KEY || storedOpenAi)
  };
};

export const getRuntimeConfig = async (env: Env): Promise<RuntimeConfig> => {
  const [storedProvider, storedModel] = await Promise.all([
    getConfigValue(env.DB, "ai_provider"),
    getConfigValue(env.DB, "ai_model")
  ]);
  const rawProvider = storedProvider ?? DEFAULT_PROVIDER;
  const aiProvider = PROVIDERS.has(rawProvider as AiProvider)
    ? rawProvider as AiProvider
    : DEFAULT_PROVIDER;
  const aiModel = storedModel ?? DEFAULT_MODEL;

  if (aiProvider === "deepseek") {
    return {
      aiProvider,
      aiModel,
      apiKey: env.DEEPSEEK_API_KEY || await getStoredSecret(env, "deepseek_api_key")
    };
  }

  if (aiProvider === "openai") {
    return {
      aiProvider,
      aiModel,
      apiKey: env.OPENAI_API_KEY || await getStoredSecret(env, "openai_api_key")
    };
  }

  return { aiProvider, aiModel };
};

const ALLOWED_USER_KEY = "allowed_user_id";

export const getAllowedUserId = async (env: Env): Promise<string | null> => {
  const encrypted = await getConfigValue(env.DB, ALLOWED_USER_KEY);
  return encrypted ? await decryptText(env.BOT_STATE_ENC_KEY, encrypted) : null;
};

export const setAllowedUserId = async (env: Env, userId: string | null): Promise<void> => {
  if (!userId) {
    await deleteConfigValue(env.DB, ALLOWED_USER_KEY);
    return;
  }
  await setConfigValue(env.DB, ALLOWED_USER_KEY, await encryptText(env.BOT_STATE_ENC_KEY, userId));
};
