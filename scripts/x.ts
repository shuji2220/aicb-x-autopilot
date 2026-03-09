import { TwitterApi } from "twitter-api-v2";
import { tweetWeight } from "./x_text";
export { tweetWeight } from "./x_text";

function mustGetEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
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

function pickHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const key of SAFE_HEADERS) {
    if (headers[key] != null) out[key] = String(headers[key]);
  }
  return out;
}

function formatTwitterError(err: any, tweetText: string): string {
  const lines: string[] = [];
  lines.push(`X API error`);

  // identity
  if (err?.name) lines.push(`name=${err.name}`);
  lines.push(`code=${err?.code ?? "none"}`);
  lines.push(`status=${err?.status ?? err?.response?.status ?? "unknown"}`);

  // twitter-api-v2 ApiResponseError puts .data / .errors / .rateLimit on top level
  const data: any = err?.data || err?.response?.data;
  if (data) {
    if (data.title) lines.push(`title=${data.title}`);
    if (data.detail) lines.push(`detail=${data.detail}`);
    if (data.type) lines.push(`type=${data.type}`);
    if (data.status) lines.push(`data.status=${data.status}`);
    if (data.errors) lines.push(`data.errors=${safeStringify(data.errors)}`);
    if (data.reason) lines.push(`data.reason=${data.reason}`);
    // full data dump
    lines.push(`data.full=${safeStringify(data)}`);
  }

  // top-level .errors (ApiResponseError specific)
  if (err?.errors && err.errors !== data?.errors) {
    lines.push(`err.errors=${safeStringify(err.errors)}`);
  }

  // rate limit info (ApiResponseError specific)
  if (err?.rateLimit) {
    lines.push(`rateLimit=${safeStringify(err.rateLimit)}`);
  }

  // safe headers
  const headers = pickHeaders(err?.headers || err?.response?.headers);
  const hdrEntries = Object.entries(headers);
  if (hdrEntries.length > 0) {
    lines.push(`headers: ${hdrEntries.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }

  // tweet text metadata (no secrets, no full text)
  lines.push(`textLen=${tweetText.length}`);
  lines.push(`textHead=${tweetText.slice(0, 100)}`);

  // original error message
  if (err?.message) lines.push(`original=${err.message}`);

  return lines.join("\n");
}

function maskEnv(key: string): string {
  const v = process.env[key] ?? "";
  if (v.length <= 4) return "****";
  return "****" + v.slice(-4);
}

export type TweetResult = {
  tweetId: string;
  whoami: { screenName?: string; username?: string; id?: string };
  maskedKeys: Record<string, string>;
};

const ENV_KEYS = [
  "X_API_KEY",
  "X_API_KEY_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
] as const;

export type TweetMetrics = {
  tweet_id: string;
  like_count: number;
  retweet_count: number;
  reply_count: number;
  impression_count: number;
  quote_count: number;
};

/**
 * Fetch public metrics for a list of tweet IDs.
 * X API v2 allows up to 100 IDs per request.
 */
export async function getTweetMetrics(tweetIds: string[]): Promise<TweetMetrics[]> {
  if (tweetIds.length === 0) return [];

  const client = new TwitterApi({
    appKey: mustGetEnv("X_API_KEY"),
    appSecret: mustGetEnv("X_API_KEY_SECRET"),
    accessToken: mustGetEnv("X_ACCESS_TOKEN"),
    accessSecret: mustGetEnv("X_ACCESS_TOKEN_SECRET"),
  });

  const { data } = await client.v2.tweets(tweetIds, {
    "tweet.fields": ["public_metrics"],
  });

  if (!data) return [];

  return data.map((t) => ({
    tweet_id: t.id,
    like_count: t.public_metrics?.like_count ?? 0,
    retweet_count: t.public_metrics?.retweet_count ?? 0,
    reply_count: t.public_metrics?.reply_count ?? 0,
    impression_count: t.public_metrics?.impression_count ?? 0,
    quote_count: t.public_metrics?.quote_count ?? 0,
  }));
}

export type AccountMetrics = {
  followers_count: number;
  following_count: number;
  tweet_count: number;
  listed_count: number;
  fetched_at: string;
};

/**
 * Fetch account-level public metrics (follower count, etc.) via v2 /users/me.
 */
export async function getAccountMetrics(): Promise<AccountMetrics> {
  const client = new TwitterApi({
    appKey: mustGetEnv("X_API_KEY"),
    appSecret: mustGetEnv("X_API_KEY_SECRET"),
    accessToken: mustGetEnv("X_ACCESS_TOKEN"),
    accessSecret: mustGetEnv("X_ACCESS_TOKEN_SECRET"),
  });

  const { data } = await client.v2.me({
    "user.fields": ["public_metrics"],
  });

  const pm = data.public_metrics;
  return {
    followers_count: pm?.followers_count ?? 0,
    following_count: pm?.following_count ?? 0,
    tweet_count: pm?.tweet_count ?? 0,
    listed_count: pm?.listed_count ?? 0,
    fetched_at: new Date().toISOString(),
  };
}

export async function postTweet(
  text: string
): Promise<TweetResult> {
  const maskedKeys: Record<string, string> = {};
  for (const k of ENV_KEYS) maskedKeys[k] = maskEnv(k);

  const client = new TwitterApi({
    appKey: mustGetEnv("X_API_KEY"),
    appSecret: mustGetEnv("X_API_KEY_SECRET"),
    accessToken: mustGetEnv("X_ACCESS_TOKEN"),
    accessSecret: mustGetEnv("X_ACCESS_TOKEN_SECRET"),
  });

  const whoami: TweetResult["whoami"] = {};

  // pre-flight: v1 verifyCredentials
  try {
    const creds = await client.v1.verifyCredentials();
    whoami.screenName = creds.screen_name;
  } catch (err: any) {
    const detail = formatTwitterError(err, text);
    throw new Error(`v1.verifyCredentials failed\nmaskedKeys=${safeStringify(maskedKeys)}\n${detail}`);
  }

  // pre-flight: v2 me
  try {
    const me = await client.v2.me();
    whoami.username = me.data.username;
    whoami.id = me.data.id;
  } catch (err: any) {
    const detail = formatTwitterError(err, text);
    throw new Error(`v2.me failed\nwhoami=${safeStringify(whoami)}\nmaskedKeys=${safeStringify(maskedKeys)}\n${detail}`);
  }

  // pre-flight: weight check
  const weight = tweetWeight(text);
  if (weight > 280) {
    throw new Error(
      `Tweet too long: ${weight} weight (max 280)\n` +
      `textLen=${text.length}\n` +
      `textHead=${text.slice(0, 100)}`
    );
  }

  // tweet
  try {
    const { data } = await client.v2.tweet(text);
    return { tweetId: data.id, whoami, maskedKeys };
  } catch (err: any) {
    const detail = formatTwitterError(err, text);
    throw new Error(`v2.tweet failed\nwhoami=${safeStringify(whoami)}\nmaskedKeys=${safeStringify(maskedKeys)}\n${detail}`);
  }
}
