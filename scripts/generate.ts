// scripts/generate.ts
import "dotenv/config";
import { sendTelegramMessage } from "./telegram";
import { readState, writeState } from "./state";
import { callClaudeJson } from "./claude";
import { buildDraftSystem, buildDraftUser, TARGETS, Category } from "./prompts";
import { shortenTweet } from "./x_text";
import { buildPerformanceSummary } from "./analyze";

function mustGetEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

// 配分に近づけるための簡易スケジューラ（MVP）
// 40/25/20/10/5 を “出現頻度”として並べ、投稿数で回す
function pickCategory(counts: Record<string, number>): Category {
  const order: Category[] = [
    "usecase",
    "usecase",
    "usecase",
    "usecase",
    "success",
    "success",
    "success",
    "prompt",
    "prompt",
    "vision",
    "devlog",
  ];
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return order[total % order.length];
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

  // ID（ローカルはUTCになるけど運用上問題なし。後でJSTに寄せてもOK）
  const todayId = new Date().toISOString().slice(0, 10);

  const category = pickCategory(state.strategy.category_counts);
  const target = TARGETS[state.strategy.target_index % TARGETS.length];

  const recentPosts = state.history
    .slice(0, 5)
    .map((h) =>
      String(h.text ?? "")
        .replace(/\s+/g, " ")
        .slice(0, 120)
    );

  // 成績フィードバック（メトリクスがあれば注入）
  const performanceSummary = buildPerformanceSummary(state.history);

  const system = buildDraftSystem({
    brand: state.policy.brand,
    ctaUrl: state.policy.cta_url,
    hashtagsMax: state.policy.hashtags_max,
    lengthHint: state.policy.length_hint,
    bannedPhrases: state.policy.banned_phrases,
  });

  const user = buildDraftUser({
    category,
    target,
    recentPosts,
    ctaUrl: state.policy.cta_url,
    performanceSummary,
  });

  const out = await callClaudeJson({
    apiKey: anthropicKey,
    model: anthropicModel,
    system,
    user,
    maxTokens: 900,
  });

  const rawDraft = String(out?.draft_text ?? "").trim();
  if (!rawDraft) throw new Error("Claude output missing draft_text");

  // Normalize and auto-shorten if over 280 weight
  const { text: draftText, shortened, originalWeight, finalWeight } = shortenTweet(rawDraft);

  state.pending = {
    id: todayId,
    status: "pending",
    draft_text: draftText,
    created_at: new Date().toISOString(),
    revision: 0,
  };

  // カウンタ更新（配分維持）
  state.strategy.category_counts[category] =
    (state.strategy.category_counts[category] ?? 0) + 1;
  state.strategy.target_index = (state.strategy.target_index + 1) % TARGETS.length;

  writeState(state);

  const weightInfo = shortened
    ? `⚠️ 自動短縮: ${originalWeight}→${finalWeight} weight\n`
    : `✅ ${finalWeight} weight\n`;

  await sendTelegramMessage({
    botToken,
    chatId,
    text:
      `📝【下書き】ID: ${todayId}\n` +
      `カテゴリ: ${category}\n` +
      `ターゲット: ${target}\n` +
      weightInfo + `\n` +
      `${draftText}\n\n` +
      `操作:\n` +
      `- 承認: /approve ${todayId}\n` +
      `- 修正: /revise ${todayId} 〇〇を短く/語尾調整/など\n` +
      `- 却下: /reject ${todayId}`,
    options: { disable_web_page_preview: true },
  });

  console.log("Generated draft and sent to Telegram.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});