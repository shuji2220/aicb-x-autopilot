// scripts/report.ts
import "dotenv/config";
import { sendTelegramMessage } from "./telegram";
import { readState, writeState } from "./state";
import { getTweetMetrics, TweetMetrics } from "./x";
import { callClaudeJson } from "./claude";
import { buildAnalysisInsight } from "./analyze";

function mustGetEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

async function main() {
  const botToken = mustGetEnv("TELEGRAM_BOT_TOKEN");
  const chatId = mustGetEnv("TELEGRAM_CHAT_ID");

  const state = readState();
  const history = state.history;

  if (history.length === 0) {
    await sendTelegramMessage({
      botToken,
      chatId,
      text: "📊 レポート: まだ投稿履歴がありません。",
    });
    return;
  }

  // 直近7件（最大）のメトリクスを取得
  const recent = history.slice(0, 7);
  const tweetIds = recent.map((h: any) => String(h.tweet_id)).filter(Boolean);

  let metrics: TweetMetrics[] = [];
  try {
    metrics = await getTweetMetrics(tweetIds);
  } catch (err: any) {
    console.error("Failed to fetch metrics:", err?.message);
    await sendTelegramMessage({
      botToken,
      chatId,
      text: `📊 レポート: メトリクス取得に失敗しました。\n${err?.message ?? "Unknown error"}`,
    });
    return;
  }

  // tweet_id → metrics のマップ
  const metricsMap = new Map<string, TweetMetrics>();
  for (const m of metrics) metricsMap.set(m.tweet_id, m);

  // 合計
  let totalLikes = 0;
  let totalRTs = 0;
  let totalReplies = 0;
  let totalImps = 0;

  const rows: string[] = [];
  for (const h of recent) {
    const tid = String(h.tweet_id);
    const m = metricsMap.get(tid);
    const date = String(h.id ?? "");
    const textHead = String(h.text ?? "").replace(/\s+/g, " ").slice(0, 30);

    if (m) {
      totalLikes += m.like_count;
      totalRTs += m.retweet_count;
      totalReplies += m.reply_count;
      totalImps += m.impression_count;

      rows.push(
        `${date} | ${textHead}…\n` +
        `  ❤️${m.like_count} 🔁${m.retweet_count} 💬${m.reply_count} 👁${m.impression_count}`
      );
    } else {
      rows.push(`${date} | ${textHead}…\n  (メトリクス取得不可)`);
    }
  }

  const summary =
    `📊【投稿レポート】直近${recent.length}件\n\n` +
    rows.join("\n\n") +
    `\n\n` +
    `── 合計 ──\n` +
    `❤️ ${totalLikes} | 🔁 ${totalRTs} | 💬 ${totalReplies} | 👁 ${totalImps}\n` +
    `総投稿数: ${history.length}`;

  // メトリクスを history に永続化
  let updated = false;
  for (const h of history) {
    const m = metricsMap.get(String(h.tweet_id));
    if (m) {
      h.metrics = {
        like_count: m.like_count,
        retweet_count: m.retweet_count,
        reply_count: m.reply_count,
        impression_count: m.impression_count,
        quote_count: m.quote_count,
        fetched_at: new Date().toISOString(),
      };
      updated = true;
    }
  }
  if (updated) {
    writeState(state);
    console.log("Metrics saved to state.json.");
  }

  await sendTelegramMessage({
    botToken,
    chatId,
    text: summary,
  });

  console.log("Report sent to Telegram.");

  // Claude分析インサイト
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const anthropicModel = process.env.ANTHROPIC_MODEL;
  if (anthropicKey && anthropicModel) {
    try {
      const insightUser = buildAnalysisInsight(history, metricsMap);
      const insight = await callClaudeJson({
        apiKey: anthropicKey,
        model: anthropicModel,
        system:
          "あなたはSNS戦略アナリストです。X投稿データを分析し、次の投稿戦略への具体的な示唆を出してください。必ず指定のJSON形式のみで返してください。前置き・マークダウン・コードフェンスは一切不要です。",
        user: insightUser,
        maxTokens: 800,
      });

      state.analysis_insight = {
        updated_at: new Date().toISOString(),
        best_post_type: String(insight?.best_post_type ?? ""),
        best_post_time_hint: String(insight?.best_post_time_hint ?? ""),
        trend_keywords: Array.isArray(insight?.trend_keywords) ? insight.trend_keywords : [],
        recommendations: Array.isArray(insight?.recommendations) ? insight.recommendations : [],
        raw: insight,
      };
      writeState(state);

      if (state.analysis_insight.recommendations.length > 0) {
        const ai = state.analysis_insight;
        const recList = ai.recommendations
          .map((r: string, i: number) => `${i + 1}. ${r}`)
          .join("\n");
        const insightMsg =
          `🧠【AI分析インサイト】\n` +
          `ベスト投稿タイプ: ${ai.best_post_type}\n` +
          `推奨投稿時間帯: ${ai.best_post_time_hint}\n` +
          `注目キーワード: ${ai.trend_keywords.join(", ")}\n` +
          `📌 次の投稿への提言:\n${recList}`;
        await sendTelegramMessage({ botToken, chatId, text: insightMsg });
      }

      console.log("Analysis insight saved and sent.");
    } catch (err: any) {
      console.error("Claude analysis failed:", err?.message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
