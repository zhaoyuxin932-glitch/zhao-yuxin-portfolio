import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const client = path.join(dist, "client");
const server = path.join(dist, "server");
const imageDir = path.join(root, "portfolio-images");

rmSync(dist, { recursive: true, force: true });
mkdirSync(client, { recursive: true });
mkdirSync(server, { recursive: true });
mkdirSync(path.join(dist, ".openai"), { recursive: true });

cpSync(path.join(root, "public"), client, { recursive: true });
mkdirSync(path.join(client, "media"), { recursive: true });

const imageNames = readdirSync(imageDir)
  .filter((name) => /\.(jpe?g|png|webp|gif|avif)$/i.test(name))
  .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));

for (const name of imageNames) {
  copyFileSync(path.join(imageDir, name), path.join(client, "media", name));
}

writeFileSync(path.join(client, "images-manifest.json"), JSON.stringify(imageNames, null, 2));
copyFileSync(path.join(root, "worker", "index.js"), path.join(server, "index.js"));
copyFileSync(path.join(root, ".openai", "hosting.json"), path.join(dist, ".openai", "hosting.json"));

for (const file of [
  path.join(client, "index.html"),
  path.join(server, "index.js"),
  path.join(dist, ".openai", "hosting.json"),
]) {
  if (!existsSync(file)) throw new Error(`Missing Sites build output: ${file}`);
}

console.log(`Prepared Sites build with ${imageNames.length} images.`);
