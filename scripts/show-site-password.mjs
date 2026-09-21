import { readFileSync } from "node:fs";
import crypto from "node:crypto";

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return null;
    const index = trimmed.indexOf("=");
    if (index === -1) return null;
    return [trimmed.slice(0, index), trimmed.slice(index + 1)];
  }).filter(Boolean));
}

const env = parseEnv(readFileSync(new URL("../.env", import.meta.url), "utf8"));
const createdAt = new Date(env.CREATED_AT);
const rotationDays = Number(env.PASSWORD_ROTATION_DAYS || 10);
const period = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / (rotationDays * 24 * 60 * 60 * 1000)));
const passwordForPeriod = (value) => crypto
  .createHmac("sha256", env.PASSWORD_SEED)
  .update(`password:${value}`)
  .digest("base64url")
  .slice(0, 12);

const currentPassword = passwordForPeriod(period);
const nextPassword = passwordForPeriod(period + 1);
const nextRotationAt = new Date(createdAt.getTime() + (period + 1) * rotationDays * 24 * 60 * 60 * 1000);
const expiresAt = new Date(createdAt.getTime() + Number(env.SITE_EXPIRES_AFTER_DAYS || 60) * 24 * 60 * 60 * 1000);

console.log(`Current password: ${currentPassword}`);
console.log(`Next password: ${nextPassword}`);
console.log(`Next rotation: ${nextRotationAt.toISOString()}`);
console.log(`Site expires: ${expiresAt.toISOString()}`);
