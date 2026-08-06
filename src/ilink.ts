const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION = "1.0.3";

export interface IlinkMessageItem {
  type?: number;
  text_item?: { text?: string };
  ref_msg?: { title?: string; message_item?: IlinkMessageItem };
}

export interface IlinkMessage {
  message_id?: number;
  from_user_id?: string;
  message_type?: number;
  context_token?: string;
  item_list?: IlinkMessageItem[];
}

interface IlinkBaseResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  err_msg?: string;
  error?: string;
}

export class IlinkApiError extends Error {
  public constructor(
    message: string,
    public readonly httpStatus?: number,
    public readonly ret?: number,
    public readonly errcode?: number
  ) {
    super(message);
    this.name = "IlinkApiError";
  }

  public get requiresLogin(): boolean {
    return this.httpStatus === 401 || this.httpStatus === 403 || this.errcode === -14 || this.ret === -14;
  }
}

const randomWechatUin = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const number = new DataView(bytes.buffer).getUint32(0).toString();
  return btoa(number);
};

const extractErrorMessage = (body: IlinkBaseResponse): string =>
  body.errmsg || body.err_msg || body.error || `iLink ret=${body.ret ?? 0} errcode=${body.errcode ?? 0}`;

export class IlinkClient {
  private readonly fetchImpl: typeof fetch;

  public constructor(
    private readonly baseUrl = DEFAULT_BASE_URL,
    fetchImpl: typeof fetch = globalThis.fetch
  ) {
    // Cloudflare Workers requires native fetch to be invoked with the global
    // scope as its receiver. Calling a stored native function as an instance
    // method makes `this` the IlinkClient and raises "Illegal invocation".
    this.fetchImpl = fetchImpl.bind(globalThis);
  }

  public async getBotQrcode(): Promise<{ key: string; content: string }> {
    const response = await this.request<{ qrcode: string; qrcode_img_content: string }>(
      "GET",
      "/ilink/bot/get_bot_qrcode?bot_type=3",
      undefined,
      undefined,
      15_000,
      { "iLink-App-ClientVersion": "1" }
    );
    return { key: response.qrcode, content: response.qrcode_img_content };
  }

  public async getQrcodeStatus(key: string): Promise<{
    status: "wait" | "scanned" | "confirmed" | "expired";
    botToken?: string;
    accountId?: string;
    userId?: string;
    baseUrl?: string;
  }> {
    const response = await this.request<{
      status: "wait" | "scaned" | "confirmed" | "expired";
      bot_token?: string;
      ilink_bot_id?: string;
      ilink_user_id?: string;
      baseurl?: string;
    }>(
      "GET",
      `/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(key)}`,
      undefined,
      undefined,
      35_000,
      { "iLink-App-ClientVersion": "1" }
    );

    return {
      status: response.status === "scaned" ? "scanned" : response.status,
      botToken: response.bot_token,
      accountId: response.ilink_bot_id,
      userId: response.ilink_user_id,
      baseUrl: response.baseurl
    };
  }

  public async getUpdates(token: string, buffer: string): Promise<{
    buffer: string;
    messages: IlinkMessage[];
  }> {
    try {
      const response = await this.request<IlinkBaseResponse & {
        get_updates_buf?: string;
        msgs?: IlinkMessage[];
      }>("POST", "/ilink/bot/getupdates", token, {
        get_updates_buf: buffer,
        base_info: { channel_version: CHANNEL_VERSION }
      }, 40_000);
      this.assertSuccess(response);
      return { buffer: response.get_updates_buf ?? buffer, messages: response.msgs ?? [] };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { buffer, messages: [] };
      }
      throw error;
    }
  }

  public async sendTextMessage(
    token: string,
    toUserId: string,
    text: string,
    contextToken: string
  ): Promise<void> {
    const response = await this.request<IlinkBaseResponse>("POST", "/ilink/bot/sendmessage", token, {
      msg: {
        from_user_id: "",
        to_user_id: toUserId,
        client_id: `bot-${Date.now()}-${crypto.randomUUID()}`,
        message_type: 2,
        message_state: 2,
        context_token: contextToken,
        item_list: [{ type: 1, text_item: { text } }]
      },
      base_info: { channel_version: CHANNEL_VERSION }
    });
    this.assertSuccess(response);
  }

  public async sendTyping(token: string, userId: string, contextToken: string): Promise<void> {
    const config = await this.request<IlinkBaseResponse & { typing_ticket?: string }>(
      "POST",
      "/ilink/bot/getconfig",
      token,
      {
        ilink_user_id: userId,
        context_token: contextToken,
        base_info: { channel_version: CHANNEL_VERSION }
      }
    );
    this.assertSuccess(config);
    if (!config.typing_ticket) throw new IlinkApiError("iLink did not return a typing ticket");

    const response = await this.request<IlinkBaseResponse>("POST", "/ilink/bot/sendtyping", token, {
      ilink_user_id: userId,
      typing_ticket: config.typing_ticket,
      status: 1,
      base_info: { channel_version: CHANNEL_VERSION }
    });
    this.assertSuccess(response);
  }

  private async request<T extends object>(
    method: "GET" | "POST",
    path: string,
    token?: string,
    body?: Record<string, unknown>,
    timeoutMs = 15_000,
    extraHeaders: Record<string, string> = {}
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = new Headers(extraHeaders);
    headers.set("AuthorizationType", "ilink_bot_token");
    headers.set("X-WECHAT-UIN", randomWechatUin());
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (body) headers.set("Content-Type", "application/json");

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const text = await response.text();
      const parsed = text ? JSON.parse(text) as T & IlinkBaseResponse : {} as T & IlinkBaseResponse;
      if (!response.ok) {
        throw new IlinkApiError(extractErrorMessage(parsed), response.status, parsed.ret, parsed.errcode);
      }
      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }

  private assertSuccess(response: IlinkBaseResponse): void {
    const ret = response.ret ?? 0;
    const errcode = response.errcode ?? 0;
    if (ret !== 0 || errcode !== 0) {
      throw new IlinkApiError(extractErrorMessage(response), 200, ret, errcode);
    }
  }
}

export const extractText = (message: IlinkMessage): string => {
  for (const item of message.item_list ?? []) {
    if (item.type !== 1 || !item.text_item?.text) continue;
    const title = item.ref_msg?.title?.trim();
    return title ? `[引用: ${title}]\n${item.text_item.text}` : item.text_item.text;
  }
  return "";
};
