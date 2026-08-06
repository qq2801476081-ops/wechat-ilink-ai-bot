const encoder = new TextEncoder();
const decoder = new TextDecoder();

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const importKey = async (secret: string): Promise<CryptoKey> => {
  const keyBytes = encoder.encode(secret);
  if (keyBytes.byteLength !== 32) {
    throw new Error("BOT_STATE_ENC_KEY must be exactly 32 UTF-8 bytes");
  }

  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
};

export const encryptText = async (secret: string, plaintext: string): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(secret);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
};

export const decryptText = async (secret: string, encrypted: string): Promise<string> => {
  const [version, ivValue, ciphertextValue] = encrypted.split(".");
  if (version !== "v1" || !ivValue || !ciphertextValue) {
    throw new Error("Invalid encrypted payload");
  }

  const key = await importKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(ivValue)) },
    key,
    toArrayBuffer(base64ToBytes(ciphertextValue))
  );
  return decoder.decode(plaintext);
};

export const encryptJson = async <T>(secret: string, value: T): Promise<string> =>
  encryptText(secret, JSON.stringify(value));

export const decryptJson = async <T>(secret: string, encrypted: string): Promise<T> =>
  JSON.parse(await decryptText(secret, encrypted)) as T;
