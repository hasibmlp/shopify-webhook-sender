import crypto from "node:crypto";

export function hmacBase64(secret: string, rawJson: string) {
  return crypto
    .createHmac("sha256", secret)
    .update(rawJson, "utf8")
    .digest("base64");
}
