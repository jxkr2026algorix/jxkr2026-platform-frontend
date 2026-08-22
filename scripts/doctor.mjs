#!/usr/bin/env node
/**
 * Check the local setup against whichever backend it is pointed at.
 *
 * A misconfigured environment does not announce itself: the dashboard renders,
 * the map loads, and nothing ever arrives. Every failure below has cost real
 * debugging time, so each one is checked explicitly and named.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ok = "\x1b[32m✓\x1b[0m";
const bad = "\x1b[31m✗\x1b[0m";
const warn = "\x1b[33m!\x1b[0m";
let failures = 0;

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const envPath = resolve(root, ".env.local");
const env = { ...readEnvFile(envPath), ...process.env };
const target = env.SALGIL_PLATFORM_API_URL ?? "http://127.0.0.1:8000";
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)\b/.test(target);

console.log(`\n  설정 파일  ${existsSync(envPath) ? envPath : "(.env.local 없음 — 기본값 사용)"}`);
console.log(`  백엔드     ${target}${isLocal ? "  (로컬)" : "  (원격)"}\n`);

async function probe(label, url, key) {
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 401 || response.status === 403) {
      // The single most common failure, and the one that looks like something
      // else entirely: everything renders and nothing ever arrives.
      console.log(`  ${bad} ${label}: ${response.status} — 키가 없거나 이 백엔드가 모르는 키입니다`);
      failures++;
      return null;
    }
    if (!response.ok) {
      console.log(`  ${bad} ${label}: ${response.status}`);
      failures++;
      return null;
    }
    console.log(`  ${ok} ${label}`);
    return response;
  } catch (error) {
    const reason = String(error).includes("TimeoutError") ? "응답 없음" : "연결 실패";
    console.log(`  ${bad} ${label}: ${reason}`);
    if (isLocal) console.log("      백엔드가 떠 있나요?  uvicorn app.main:app --port 8000");
    failures++;
    return null;
  }
}

for (const [role, keyVar] of [
  ["운영 콘솔", "SALGIL_OPERATOR_API_KEY"],
  ["모바일", "SALGIL_MOBILE_API_KEY"],
]) {
  const key = env[keyVar] || env.SALGIL_PLATFORM_API_KEY || (isLocal ? "dev-operator" : "");
  if (!key) {
    console.log(`  ${bad} ${role}: 키 없음 — .env.local 에 ${keyVar} 를 넣으세요`);
    failures++;
    continue;
  }
  await probe(`${role} 인증`, `${target}/api/v1/meta/hazards`, key);
}

const operatorKey =
  env.SALGIL_OPERATOR_API_KEY || env.SALGIL_PLATFORM_API_KEY || (isLocal ? "dev-operator" : "");

// The chatbot and background push each fail silently when unconfigured, so
// both report their own state rather than being inferred from a working call.
for (const [label, path, field, hint] of [
  ["챗봇", "/api/v1/assistant/status", "configured", "SALGIL_UPSTAGE_API_KEY 를 백엔드에 넣으세요"],
  ["주민 푸시", "/api/v1/push/key", "configured", "백엔드에서 python -m app.cli push-keys"],
]) {
  const response = await probe(`${label} 도달`, `${target}${path}`, operatorKey);
  if (!response) continue;
  const body = await response.json().catch(() => ({}));
  if (!body[field]) {
    console.log(`  ${warn} ${label}: 백엔드에 키가 없어 꺼져 있습니다 — ${hint}`);
  }
}

console.log(
  failures
    ? `\n  ${failures}건 실패. 위 항목을 고치고 다시 실행하세요.\n`
    : "\n  전부 통과. yarn dev 로 띄우세요.\n",
);
process.exit(failures ? 1 : 0);
