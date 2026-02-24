import { getTelegramUpdates, sendTelegramMessage } from "./telegram";
import { readState, writeState } from "./state";

function mustGetEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

type Command =
  | { kind: "approve"; id: string }
  | { kind: "reject"; id: string }
  | { kind: "revise"; id: string; instruction: string }
  | { kind: "unknown" };

function parseCommand(text: string): Command {
  const t = text.trim();

  // 先頭スラッシュあり/なし両対応
  const approve = t.match(/^\/?approve\s+(\S+)$/i);
  if (approve) return { kind: "approve", id: approve[1] };

  const reject = t.match(/^\/?reject\s+(\S+)$/i);
  if (reject) return { kind: "reject", id: reject[1] };

  const revise = t.match(/^\/?revise\s+(\S+)\s+([\s\S]+)$/i);
  if (revise) return { kind: "revise", id: revise[1], instruction: revise[2].trim() };

  return { kind: "unknown" };
}

async function main() {
  const botToken = mustGetEnv("TELEGRAM_BOT_TOKEN");
  const chatId = mustGetEnv("TELEGRAM_CHAT_ID");

  const state = readState();

  const updates = await getTelegramUpdates({
    botToken,
    offset: state.telegram.last_update_id ? state.telegram.last_update_id + 1 : undefined,
    timeoutSec: 0,
  });

  const result: any[] = updates?.result ?? [];
  if (result.length === 0) {
    console.log("No updates.");
    return;
  }

  // last_update_id を進める（重複処理防止）
  const maxUpdateId = Math.max(...result.map((u) => u.update_id));
  state.telegram.last_update_id = maxUpdateId;

  // 自分のchat以外は無視（安全）
  const messages = result
    .map((u) => u.message)
    .filter(Boolean)
    .filter((m: any) => String(m.chat?.id) === String(chatId));

  if (messages.length === 0) {
    writeState(state);
    console.log("Updates exist, but none from target chat.");
    return;
  }

  for (const m of messages) {
    const text = String(m.text ?? "");
    const cmd = parseCommand(text);

    if (cmd.kind === "unknown") continue;

    // pending がない場合
    if (!state.pending) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `⚠️ pendingがありません。/approve の前に下書きを生成してください。`,
      });
      continue;
    }

    // ID不一致
    if (state.pending.id !== cmd.id) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `⚠️ IDが一致しません。\npending: ${state.pending.id}\n入力: ${cmd.id}`,
      });
      continue;
    }

    if (cmd.kind === "reject") {
      state.pending = null;
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `🗑️ 下書き ${cmd.id} を却下しました（本日は投稿しません）。`,
      });
      continue;
    }

    if (cmd.kind === "approve") {
      // まだX投稿はしない（次ステップ）。いまは承認検知まで。
      state.pending.status = "posting";
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `✅ 承認を検知しました：${cmd.id}\n次ステップでX投稿を接続します。`,
      });
      continue;
    }

    if (cmd.kind === "revise") {
      // まだClaude再生成は次ステップ。いまは指示を受け取ったことだけ返す
      state.pending.revision += 1;
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `✍️ 修正指示を受け取りました：${cmd.id}\n指示: ${cmd.instruction}\n次ステップでClaude再生成を接続します。`,
      });
      continue;
    }
  }

  writeState(state);
  console.log("Processed updates.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});