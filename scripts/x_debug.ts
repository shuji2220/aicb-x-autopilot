import "dotenv/config";
import { TwitterApi } from "twitter-api-v2";
import { readState } from "./state";

function mustGetEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

const SAFE_HEADERS = [
  "x-request-id",
  "x-rate-limit-limit",
  "x-rate-limit-remaining",
  "x-rate-limit-reset",
] as const;

function formatError(err: any): string {
  const status = err?.code || err?.status || err?.response?.status;
  const data: any = err?.data || err?.response?.data;
  const headers: Record<string, unknown> | undefined =
    err?.headers || err?.response?.headers;

  const lines: string[] = [];
  lines.push(`status=${status ?? "unknown"}`);

  if (data) {
    if (data.title) lines.push(`title=${data.title}`);
    if (data.detail) lines.push(`detail=${data.detail}`);
    if (data.type) lines.push(`type=${data.type}`);
    if (data.errors) lines.push(`errors=${safeStringify(data.errors)}`);
    if (!data.title && !data.errors) lines.push(`data=${safeStringify(data)}`);
  }

  if (headers) {
    for (const key of SAFE_HEADERS) {
      if (headers[key] != null) lines.push(`${key}=${headers[key]}`);
    }
  }

  if (err?.message) lines.push(`original=${err.message}`);

  return lines.join("\n");
}

async function main() {
  const client = new TwitterApi({
    appKey: mustGetEnv("X_API_KEY"),
    appSecret: mustGetEnv("X_API_KEY_SECRET"),
    accessToken: mustGetEnv("X_ACCESS_TOKEN"),
    accessSecret: mustGetEnv("X_ACCESS_TOKEN_SECRET"),
  });

  // --- Step 1: v1 verifyCredentials ---
  console.log("=== Step 1: v1.verifyCredentials ===");
  try {
    const creds = await client.v1.verifyCredentials();
    console.log(`OK: screen_name=${creds.screen_name}`);
  } catch (err: any) {
    console.error("FAILED: v1.verifyCredentials");
    console.error(formatError(err));
    process.exit(1);
  }

  // --- Step 2: v2.me ---
  console.log("\n=== Step 2: v2.me ===");
  try {
    const me = await client.v2.me();
    console.log(`OK: id=${me.data.id}, username=${me.data.username}`);
  } catch (err: any) {
    console.error("FAILED: v2.me");
    console.error(formatError(err));
    process.exit(1);
  }

  // --- Step 3: v2.tweet ---
  const debugText = `debug tweet ${new Date().toISOString()}`;
  console.log(`\n=== Step 3: v2.tweet ===`);
  console.log(`textLen=${debugText.length}`);
  try {
    const { data } = await client.v2.tweet(debugText);
    console.log(`OK: tweet_id=${data.id}`);
  } catch (err: any) {
    console.error("FAILED: v2.tweet");
    console.error(formatError(err));
    process.exit(1);
  }

  // --- Step 4: state.json の実テキストで投稿テスト ---
  console.log("\n=== Step 4: v2.tweet with pending draft_text ===");
  const state = readState();
  if (!state.pending) {
    console.log("SKIP: no pending draft in state.json");
  } else {
    const realText = state.pending.draft_text;
    console.log(`textLen=${realText.length}`);
    console.log(`textHead=${realText.slice(0, 100)}`);
    try {
      const { data } = await client.v2.tweet(realText);
      console.log(`OK: tweet_id=${data.id}`);
    } catch (err: any) {
      console.error("FAILED: v2.tweet with real text");
      console.error(formatError(err));
      process.exit(1);
    }
  }

  console.log("\nAll checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
