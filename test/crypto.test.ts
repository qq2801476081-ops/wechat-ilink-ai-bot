import { describe, expect, it } from "vitest";
import { decryptJson, decryptText, encryptJson, encryptText } from "../src/crypto";

const KEY = "0123456789abcdef0123456789abcdef";

describe("AES-256-GCM helpers", () => {
  it("round-trips text without retaining plaintext", async () => {
    const encrypted = await encryptText(KEY, "sensitive-bot-token");
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("sensitive-bot-token");
    await expect(decryptText(KEY, encrypted)).resolves.toBe("sensitive-bot-token");
  });

  it("round-trips JSON and rejects a different key", async () => {
    const encrypted = await encryptJson(KEY, { botToken: "token", userId: "u1" });
    await expect(decryptJson(KEY, encrypted)).resolves.toEqual({ botToken: "token", userId: "u1" });
    await expect(decryptText("fedcba9876543210fedcba9876543210", encrypted)).rejects.toThrow();
  });

  it("requires a 32-byte key", async () => {
    await expect(encryptText("too-short", "value")).rejects.toThrow("exactly 32");
  });
});
