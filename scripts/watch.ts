import "dotenv/config";
import { getTelegramUpdates, sendTelegramMessage } from "./telegram";
import { readState, writeState, getStatePath } from "./state";
import { callClaudeJson } from "./claude";
import { buildDraftSystem, buildReviseUser } from "./prompts";
import { postTweet } from "./x";
import { shortenTweet } from "./x_text";

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
  const anthropicKey = mustGetEnv("ANTHROPIC_API_KEY");
  const anthropicModel = mustGetEnv("ANTHROPIC_MODEL");

  console.log("STATE_PATH=", getStatePath());

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

    // 冪等性ガード: pending 以外の status では操作不可
    if (state.pending.status !== "pending") {
      await sendTelegramMessage({
        botToken,
        chatId,
        text:
          `⚠️ この下書きは現在 status="${state.pending.status}" です。\n` +
          `操作できるのは status="pending" のときだけです。\n` +
          (state.pending.status === "failed"
            ? `再投稿するには /reject ${cmd.id} してから再生成してください。`
            : `しばらくお待ちください。`),
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
      // Pre-post validation: shorten if over 280 weight
      const { text: safeText, shortened, originalWeight, finalWeight } =
        shortenTweet(state.pending.draft_text);
      state.pending.draft_text = safeText;
      state.pending.status = "posting";

      try {
        const { tweetId, whoami, maskedKeys } = await postTweet(state.pending.draft_text);
        console.log("APPROVE OK tweetId=", tweetId, "whoami=", whoami);

        state.history.unshift({
          id: state.pending.id,
          posted_at: new Date().toISOString(),
          tweet_id: tweetId,
          text: state.pending.draft_text,
          revision: state.pending.revision,
        });

        console.log("BEFORE WRITE state.pending=", JSON.stringify(state.pending));
        state.pending = null;
        writeState(state);
        console.log("AFTER WRITE pending=", state.pending, "historyLen=", state.history.length);

        const keysInfo = Object.entries(maskedKeys).map(([k, v]) => `${k}=${v}`).join(", ");
        const shortenNote = shortened
          ? `⚠️ 自動短縮: ${originalWeight}→${finalWeight} weight\n`
          : "";
        await sendTelegramMessage({
          botToken,
          chatId,
          text:
            `🚀 投稿しました\n` +
            shortenNote +
            `ID: ${cmd.id}\n` +
            `tweet_id: ${tweetId}\n` +
            `URL: https://x.com/i/web/status/${tweetId}\n` +
            `whoami: @${whoami.screenName} (${whoami.username}, id=${whoami.id})\n` +
            `keys: ${keysInfo}`,
          options: { disable_web_page_preview: true },
        });
      } catch (err: any) {
        if (state.pending) {
          state.pending.status = "failed";
        }
        writeState(state);
        console.log("AFTER WRITE pending=", JSON.stringify(state.pending), "historyLen=", state.history.length);

        const reason = err?.message ?? "Unknown error";
        await sendTelegramMessage({
          botToken,
          chatId,
          text: `❌ 投稿失敗:\n${reason}`.slice(0, 3500),
        });
      }
      continue;
    }

    if (cmd.kind === "revise") {
      // 修正回数制限チェック
      if (state.pending.revision >= 2) {
        await sendTelegramMessage({
          botToken,
          chatId,
          text: `⚠️ 修正は最大2回までです。これ以上は手動で調整してください。`,
        });
        continue;
      }

      try {
        // 既存 draft_text から CTA URL 行と「AI Contents Bank開発中」行を除去して Claude に渡す
        const ctaUrl = state.policy.cta_url;
        const draftWithoutUrl = state.pending.draft_text
          .split("\n")
          .filter((line) => !line.trim().startsWith(ctaUrl))
          .filter((line) => line.trim() !== "AI Contents Bank開発中")
          .join("\n")
          .trim();

        const system = buildDraftSystem({
          brand: state.policy.brand,
          ctaUrl,
          hashtagsMax: state.policy.hashtags_max,
          lengthHint: state.policy.length_hint,
          bannedPhrases: state.policy.banned_phrases,
        });
        const user = buildReviseUser({
          currentDraft: draftWithoutUrl,
          instruction: cmd.instruction,
          ctaUrl,
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

        // Validate and shorten if needed
        const revResult = shortenTweet(rawDraft);
        state.pending.draft_text = revResult.text;
        state.pending.revision += 1;

        const revWeightInfo = revResult.shortened
          ? `⚠️ 自動短縮: ${revResult.originalWeight}→${revResult.finalWeight} weight\n`
          : `✅ ${revResult.finalWeight} weight\n`;

        await sendTelegramMessage({
          botToken,
          chatId,
          text:
            `✍️【修正版 下書き】ID: ${cmd.id} (rev:${state.pending.revision})\n` +
            revWeightInfo + `\n` +
            `${revResult.text}\n\n` +
            `操作:\n` +
            `- 承認: /approve ${cmd.id}\n` +
            `- 再修正: /revise ${cmd.id} 〇〇を短く/語尾調整/など\n` +
            `- 却下: /reject ${cmd.id}`,
          options: { disable_web_page_preview: true },
        });
      } catch (err: any) {
        const reason = err?.message ?? "Unknown error";
        await sendTelegramMessage({
          botToken,
          chatId,
          text: `❌ revise失敗: ${reason}`,
        });
      }
      continue;
    }
  }

  // Timeout auto-reject: 1時間応答なしで自動却下
  const PENDING_TIMEOUT_MS = 60 * 60 * 1000;
  if (state.pending && state.pending.status === "pending") {
    const age = Date.now() - new Date(state.pending.created_at).getTime();
    if (age > PENDING_TIMEOUT_MS) {
      const expiredId = state.pending.id;
      state.pending = null;
      writeState(state);
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `⏰ 下書き ${expiredId} は1時間以内に応答がなかったため、自動却下しました。`,
      });
      console.log("Auto-rejected due to timeout.");
      return;
    }
  }

  writeState(state);
  console.log("Processed updates.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});