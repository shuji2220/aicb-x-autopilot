// scripts/quote.ts
import "dotenv/config";
import { TwitterApi, TweetV2, UserV2 } from "twitter-api-v2";
import { sendTelegramMessage } from "./telegram";
import { readState, writeState } from "./state";
import { callClaudeJson } from "./claude";
import { buildQuoteCommentSystem, buildQuoteCommentUser } from "./prompts";

function mustGetEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

// プロフィールに含まれるべきキーワード（TARGETS に対応する職種）
const PROFILE_KEYWORDS = [
  "AI",
  "エンジニア",
  "プログラム",
  "開発",
  "CTO",
  "起業",
  "経営",
  "マーケ",
  "ライター",
  "デザイン",
];

type TweetWithAuthor = {
  tweet: TweetV2;
  author: UserV2;
};

function hasProfileKeyword(description: string | undefined): boolean {
  if (!description) return false;
  return PROFILE_KEYWORDS.some((kw) => description.includes(kw));
}

function isOfficialVerified(author: UserV2): boolean {
  // verified === true かつ verified_type が "blue" 以外（公式・組織・著名人認証）
  // twitter-api-v2 の型: verified はブール、verified_type は "blue" | "business" | "government" | undefined
  if (!author.verified) return false;
  // verified_type が undefined または "blue" 以外なら公式認証とみなす
  // "blue" は有料サブスク、それ以外は公式認証
  return author.verified_type !== "blue";
}

function scoreTweet(tweet: TweetV2): number {
  const likes = tweet.public_metrics?.like_count ?? 0;
  const retweets = tweet.public_metrics?.retweet_count ?? 0;
  return likes * 2 + retweets * 3;
}

async function searchQuoteCandidates(): Promise<TweetWithAuthor[]> {
  const client = new TwitterApi({
    appKey: mustGetEnv("X_API_KEY"),
    appSecret: mustGetEnv("X_API_KEY_SECRET"),
    accessToken: mustGetEnv("X_ACCESS_TOKEN"),
    accessSecret: mustGetEnv("X_ACCESS_TOKEN_SECRET"),
  });

  const query = "(AI OR プロンプト OR ChatGPT OR Claude) lang:ja -is:retweet";

  const result = await client.v2.search(query, {
    "tweet.fields": ["public_metrics", "author_id", "text", "reply_settings"],
    expansions: ["author_id"],
    "user.fields": ["public_metrics", "description", "verified", "verified_type"],
    max_results: 20,
  });

  if (!result.data?.data || result.data.data.length === 0) {
    return [];
  }

  const tweets = result.data.data;
  const users = result.data.includes?.users ?? [];

  // ユーザーIDからユーザー情報を引けるようにマップ化
  const userMap = new Map<string, UserV2>();
  for (const user of users) {
    userMap.set(user.id, user);
  }

  // ツイートと著者を結合
  const tweetsWithAuthors: TweetWithAuthor[] = [];
  for (const tweet of tweets) {
    const author = userMap.get(tweet.author_id ?? "");
    if (author) {
      tweetsWithAuthors.push({ tweet, author });
    }
  }

  return tweetsWithAuthors;
}

function isQuoteFriendly(tweet: TweetV2): boolean {
  // reply_settings が "everyone" または未設定なら引用可能性が高い
  const rs = (tweet as any).reply_settings;
  return !rs || rs === "everyone";
}

function filterCandidates(candidates: TweetWithAuthor[]): TweetWithAuthor[] {
  // 必須条件: フォロワー1000人以上 + 認証済み
  const base = candidates.filter(({ author }) => {
    const followers = author.public_metrics?.followers_count ?? 0;
    if (followers < 1000) return false;
    if (!author.verified) return false;
    return true;
  });

  if (base.length === 0) return [];

  // 引用制限なし（reply_settings === "everyone"）を優先
  const quoteFriendly = base.filter(({ tweet }) => isQuoteFriendly(tweet));
  if (quoteFriendly.length > 0) return quoteFriendly;

  // reply_settings が制限付きでも候補として残す（リトライで対応）
  return base;
}

async function main() {
  const botToken = mustGetEnv("TELEGRAM_BOT_TOKEN");
  const chatId = mustGetEnv("TELEGRAM_CHAT_ID");
  const anthropicKey = mustGetEnv("ANTHROPIC_API_KEY");
  const anthropicModel = mustGetEnv("ANTHROPIC_MODEL");

  const state = readState();

  // 事故防止：pendingが残ってるなら新規生成しない
  if (state.pending && state.pending.status === "pending") {
    await sendTelegramMessage({
      botToken,
      chatId,
      text:
        `⚠️ まだ承認待ちの下書きがあります（${state.pending.id}）。\n` +
        `/approve /revise /reject のどれかを先に実行してください。`,
    });
    return;
  }

  // 引用候補を検索
  console.log("Searching for quote candidates...");
  const candidates = await searchQuoteCandidates();
  console.log(`Found ${candidates.length} candidates`);

  if (candidates.length === 0) {
    await sendTelegramMessage({
      botToken,
      chatId,
      text: `⚠️ 引用候補が見つかりませんでした。`,
    });
    return;
  }

  // フィルタリング
  const filtered = filterCandidates(candidates);
  console.log(`After filtering: ${filtered.length} candidates`);

  if (filtered.length === 0) {
    await sendTelegramMessage({
      botToken,
      chatId,
      text: `⚠️ 引用候補が見つかりませんでした（フィルタ後0件）。`,
    });
    return;
  }

  // スコアリングして上位を選ぶ（リトライ用に複数候補を保持）
  filtered.sort((a, b) => scoreTweet(b.tweet) - scoreTweet(a.tweet));
  const MAX_CANDIDATES = 5;
  const topCandidates = filtered.slice(0, MAX_CANDIDATES);

  const selected = topCandidates[0];
  const tweetId = selected.tweet.id;
  const tweetText = selected.tweet.text ?? "";
  const tweetUrl = `https://x.com/i/web/status/${tweetId}`;
  const authorUsername = selected.author.username ?? "unknown";

  console.log(`Selected tweet: ${tweetId} by @${authorUsername}`);
  console.log(`Score: ${scoreTweet(selected.tweet)}`);
  console.log(`Total candidates for retry: ${topCandidates.length}`);

  // Claude で引用コメントを生成
  const system = buildQuoteCommentSystem();
  const user = buildQuoteCommentUser({ tweetText, tweetUrl });

  const out = await callClaudeJson({
    apiKey: anthropicKey,
    model: anthropicModel,
    system,
    user,
    maxTokens: 300,
  });

  const commentText = String(out?.comment_text ?? "").trim();
  if (!commentText) throw new Error("Claude output missing comment_text");

  // ID（UTC日付）
  const todayId = new Date().toISOString().slice(0, 10) + "-quote";

  // リトライ用候補リスト（1位以外）
  const backupCandidates = topCandidates.slice(1).map((c) => ({
    tweet_id: c.tweet.id,
    tweet_url: `https://x.com/i/web/status/${c.tweet.id}`,
    author_username: c.author.username ?? "unknown",
    tweet_text: (c.tweet.text ?? "").slice(0, 200),
    score: scoreTweet(c.tweet),
  }));

  state.pending = {
    id: todayId,
    status: "pending",
    draft_text: commentText,
    quote_tweet_id: tweetId,
    quote_tweet_url: tweetUrl,
    created_at: new Date().toISOString(),
    revision: 0,
    quote_candidates: backupCandidates,
  };

  writeState(state);

  // Telegram に通知
  await sendTelegramMessage({
    botToken,
    chatId,
    text:
      `📝【引用ツイート下書き】ID: ${todayId}\n\n` +
      `引用元: @${authorUsername}\n` +
      `${tweetUrl}\n\n` +
      `--- 引用元ツイート ---\n` +
      `${tweetText.slice(0, 200)}${tweetText.length > 200 ? "..." : ""}\n\n` +
      `--- 生成コメント ---\n` +
      `${commentText}\n\n` +
      `代替候補: ${backupCandidates.length}件（引用制限時に自動リトライ）\n\n` +
      `操作:\n` +
      `- 承認: /approve ${todayId}\n` +
      `- 却下: /reject ${todayId}\n` +
      `※ 引用ツイートは /revise 非対応です`,
    options: { disable_web_page_preview: true },
  });

  console.log("Generated quote draft and sent to Telegram.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
