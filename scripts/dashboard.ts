// scripts/dashboard.ts — アカウントメトリクスを定期取得し、推移を記録する
import "dotenv/config";
import { sendTelegramMessage } from "./telegram";
import { readState, writeState, DashboardSnapshot } from "./state";
import { getAccountMetrics } from "./x";

function mustGetEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

/** 最大保持件数（約3ヶ月分、日次取得想定） */
const MAX_SNAPSHOTS = 90;

function buildReport(
  current: DashboardSnapshot,
  previous: DashboardSnapshot | undefined
): string {
  const lines: string[] = [];
  lines.push("📈【ダッシュボード】アカウント推移");
  lines.push("");
  lines.push(`フォロワー: ${current.followers_count}`);
  lines.push(`フォロー: ${current.following_count}`);
  lines.push(`ツイート数: ${current.tweet_count}`);
  lines.push(`リスト登録: ${current.listed_count}`);

  if (previous) {
    const diff = current.followers_count - previous.followers_count;
    const sign = diff >= 0 ? "+" : "";
    lines.push("");
    lines.push(`── 前回比 ──`);
    lines.push(`フォロワー: ${sign}${diff}`);

    const tweetDiff = current.tweet_count - previous.tweet_count;
    const tSign = tweetDiff >= 0 ? "+" : "";
    lines.push(`ツイート数: ${tSign}${tweetDiff}`);
  }

  lines.push("");
  lines.push(`取得: ${current.fetched_at}`);
  return lines.join("\n");
}

async function main() {
  const botToken = mustGetEnv("TELEGRAM_BOT_TOKEN");
  const chatId = mustGetEnv("TELEGRAM_CHAT_ID");

  // アカウントメトリクス取得
  let metrics: DashboardSnapshot;
  try {
    metrics = await getAccountMetrics();
  } catch (err: any) {
    console.error("Failed to fetch account metrics:", err?.message);
    await sendTelegramMessage({
      botToken,
      chatId,
      text: `📈 ダッシュボード: メトリクス取得に失敗しました。\n${err?.message ?? "Unknown error"}`,
    });
    process.exit(1);
  }

  console.log("Account metrics fetched:", JSON.stringify(metrics));

  // state に保存
  const state = readState();
  if (!state.dashboard) {
    state.dashboard = { snapshots: [] };
  }

  const snapshots = state.dashboard.snapshots;
  const previous = snapshots.length > 0 ? snapshots[snapshots.length - 1] : undefined;

  snapshots.push(metrics);

  // 上限を超えたら古いものを削除
  if (snapshots.length > MAX_SNAPSHOTS) {
    state.dashboard.snapshots = snapshots.slice(-MAX_SNAPSHOTS);
  }

  writeState(state);
  console.log("Dashboard snapshot saved to state.json.");

  // Telegram にレポート送信
  const report = buildReport(metrics, previous);
  await sendTelegramMessage({ botToken, chatId, text: report });
  console.log("Dashboard report sent to Telegram.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
