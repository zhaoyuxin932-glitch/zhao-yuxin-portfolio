require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

if (process.env.PASSWORD_SEED && process.env.CREATED_AT) {
  const rotationDays = Number(process.env.PASSWORD_ROTATION_DAYS || 10);
  const expiresAfterDays = Number(process.env.SITE_EXPIRES_AFTER_DAYS || 60);
  const createdAt = new Date(process.env.CREATED_AT);
  const period = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / (rotationDays * 24 * 60 * 60 * 1000)));
  const passwordForPeriod = (value) => crypto
    .createHmac("sha256", process.env.PASSWORD_SEED)
    .update(`password:${value}`)
    .digest("base64url")
    .slice(0, 12);

  console.log(`Current password: ${passwordForPeriod(period)}`);
  console.log(`Next password: ${passwordForPeriod(period + 1)}`);
  console.log(`Next rotation: ${addDays(createdAt, (period + 1) * rotationDays).toISOString()}`);
  console.log(`Site expires: ${addDays(createdAt, expiresAfterDays).toISOString()}`);
  process.exit(0);
}

const passwordFile = path.join(__dirname, "..", "data", "current-password.txt");

if (!fs.existsSync(passwordFile)) {
  console.error("No password has been generated yet. Start the server once with npm run dev.");
  process.exit(1);
}

process.stdout.write(fs.readFileSync(passwordFile, "utf8"));
