import { describe, expect, it, vi } from "vitest";
import { extractText, IlinkApiError, IlinkClient } from "../src/ilink";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("IlinkClient", () => {
  it("invokes fetch with the global scope as receiver", async () => {
    const fetchMock = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(jsonResponse({ qrcode: "key", qrcode_img_content: "content" }));
    });

    const client = new IlinkClient("https://ilink.test", fetchMock as unknown as typeof fetch);
    await expect(client.getBotQrcode()).resolves.toEqual({ key: "key", content: "content" });
  });

  it("uses verified headers and getupdates payload", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ ret: 0, get_updates_buf: "next", msgs: [] }));
    const client = new IlinkClient("https://ilink.test", fetchMock as unknown as typeof fetch);

    await expect(client.getUpdates("bot-token", "previous")).resolves.toEqual({ buffer: "next", messages: [] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ilink.test/ilink/bot/getupdates");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer bot-token");
    expect(headers.get("AuthorizationType")).toBe("ilink_bot_token");
    expect(headers.get("X-WECHAT-UIN")).toBeTruthy();
    expect(JSON.parse(String(init.body))).toEqual({
      get_updates_buf: "previous",
      base_info: { channel_version: "1.0.3" }
    });
  });

  it("normalizes scaned and reads confirmed credentials", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      status: "confirmed",
      bot_token: "token",
      ilink_bot_id: "bot",
      ilink_user_id: "user",
      baseurl: "https://regional.test"
    }));
    const client = new IlinkClient("https://ilink.test", fetchMock as unknown as typeof fetch);
    await expect(client.getQrcodeStatus("a key")).resolves.toEqual({
      status: "confirmed",
      botToken: "token",
      accountId: "bot",
      userId: "user",
      baseUrl: "https://regional.test"
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("qrcode=a%20key");
  });

  it("obtains a typing ticket before sending typing", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ret: 0, typing_ticket: "ticket" }))
      .mockResolvedValueOnce(jsonResponse({ ret: 0 }));
    const client = new IlinkClient("https://ilink.test", fetchMock as unknown as typeof fetch);
    await client.sendTyping("token", "user-1", "ctx-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/getconfig");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/sendtyping");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({
      ilink_user_id: "user-1",
      typing_ticket: "ticket",
      status: 1
    });
  });

  it("classifies expired login errors", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ errcode: -14, errmsg: "expired" }));
    const client = new IlinkClient("https://ilink.test", fetchMock as unknown as typeof fetch);
    try {
      await client.getUpdates("token", "");
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(IlinkApiError);
      expect((error as IlinkApiError).requiresLogin).toBe(true);
    }
  });
});

describe("extractText", () => {
  it("extracts text and quoted message titles", () => {
    expect(extractText({ item_list: [{ type: 1, text_item: { text: "hello" }, ref_msg: { title: "old" } }] }))
      .toBe("[引用: old]\nhello");
  });
});
