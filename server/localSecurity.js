import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = path.resolve(dirname, "../.seogrow-data");

function persistentSecret(fileName) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, fileName);
  try {
    fs.writeFileSync(file, `${crypto.randomBytes(32).toString("hex")}\n`, {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const value = fs.readFileSync(file, "utf8").trim();
  fs.chmodSync(file, 0o600);
  if (value.length < 32) throw new Error(`Segreto locale non valido: ${fileName}`);
  return value;
}

export const localApiToken = () =>
  process.env.APP_API_TOKEN || persistentSecret("app-token");

export const credentialEncryptionKey = () =>
  process.env.CREDENTIAL_ENCRYPTION_KEY || persistentSecret("credential-key");
