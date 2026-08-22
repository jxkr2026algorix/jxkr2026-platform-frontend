#!/usr/bin/env node
/**
 * Run the three dev servers together, against one backend.
 *
 * Started separately they drift: the console ends up talking to a local
 * backend while the phone talks to the deployed one, and the two screens
 * disagree about what is happening. One command, one target, one answer.
 *
 * Pass `--remote` to force the deployed backend regardless of `.env.local`,
 * or `--local` to force your own. With neither, `.env.local` decides.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REMOTE = "https://api.salgil.gyeongbuk.kr";
const LOCAL = "http://127.0.0.1:8000";

/** Parse a dotenv file. Values are taken literally after the first `=`. */
function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

const fileEnv = readEnvFile(resolve(root, ".env.local"));
// The shell wins over the file, so a one-off override does not need an edit.
const env = { ...fileEnv, ...process.env };

const args = process.argv.slice(2);
if (args.includes("--remote")) env.SALGIL_PLATFORM_API_URL = REMOTE;
if (args.includes("--local")) env.SALGIL_PLATFORM_API_URL = LOCAL;
const target = env.SALGIL_PLATFORM_API_URL ?? LOCAL;
env.SALGIL_PLATFORM_API_URL = target;

const remote = !target.startsWith("http://127.0.0.1") && !target.startsWith("http://localhost");
const key = env.SALGIL_OPERATOR_API_KEY || env.SALGIL_PLATFORM_API_KEY;
if (remote && !key) {
  // Said before anything starts. Without a key every call is a 401 and the
  // dashboard looks like the backend is down rather than unauthenticated —
  // that cost an hour once already.
  console.error(
    `\n  ${target} 를 보려면 키가 필요합니다.\n` +
      "  .env.local 에 SALGIL_OPERATOR_API_KEY 를 넣으세요 " +
      "(cp .env.local.example .env.local).\n" +
      "  내 컴퓨터의 백엔드를 보려면:  yarn dev --local\n",
  );
  process.exit(1);
}

// Ports are pinned rather than left to vite. Only the map declares one, so the
// console and the phone both start at 5173, one of them slides to whatever is
// free, and the console's map frame and QR code then point at nothing.
const MAP = "http://localhost:5183";
const MOBILE = "http://localhost:5176";
const apps = [
  {
    name: "console",
    color: "\x1b[36m",
    script: "dev:console",
    port: 5173,
    // The console embeds the map and shows a QR to the phone. Both have to be
    // addresses a browser can actually reach, not same-origin paths.
    env: { VITE_MAP_URL: MAP, VITE_MOBILE_URL: MOBILE },
  },
  {
    name: "mobile ",
    color: "\x1b[35m",
    script: "dev:mobile",
    port: 5176,
    env: { VITE_MAP_URL: MAP },
  },
  { name: "map    ", color: "\x1b[33m", script: "dev:map", port: 5183, env: {} },
];

console.log(`\n  백엔드  ${target}${remote ? "  (실서버)" : "  (로컬)"}`);
console.log(`  키      ${key ? `${key.slice(0, 6)}…` : "개발 기본키"}\n`);
for (const app of apps)
  console.log(`  ${app.color}${app.name}\x1b[0m http://localhost:${app.port}`);
console.log("");

const children = apps.map((app) => {
  const child = spawn("yarn", [app.script, "--port", String(app.port), "--strictPort"], {
    cwd: root,
    env: { ...env, ...app.env },
    shell: false,
  });
  const prefix = (line) => `${app.color}${app.name}\x1b[0m ${line}`;
  const pipe = (stream, out) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      // Vite's banner repeats what is already printed above, three times over.
      for (const line of lines) {
        if (line.trim() && !line.includes("VITE v") && !line.includes("press h +"))
          out.write(`${prefix(line)}\n`);
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
});

const stop = () => {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
