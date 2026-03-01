import axios from "axios";

type ClaudeMessage = { role: "user" | "assistant"; content: string };

type AnthropicErrorBody = {
  type?: string;
  error?: { type?: string; message?: string };
  request_id?: string;
};

/**
 * LLM 出力から JSON 部分だけを安全に抽出する。
 * - ```json … ``` や ``` … ``` のコードフェンスを除去
 * - 最初の "{" から最後の "}" を切り出し
 */
function extractJson(raw: string): string {
  // コードフェンス除去
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

  // 最初の "{" 〜 最後の "}" を切り出す（保険）
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }

  return s;
}

export async function callClaudeJson(params: {
  apiKey: string;
  system: string;
  user: string;
  maxTokens?: number;
  model: string;
}): Promise<any> {
  const { apiKey, system, user, maxTokens, model } = params;

  try {
    const res = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model,
        max_tokens: maxTokens ?? 900,
        system,
        messages: [{ role: "user", content: user } as ClaudeMessage],
      },
      {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        timeout: 60_000,
      }
    );

    const raw = res.data?.content?.[0]?.text ?? "";
    const jsonStr = extractJson(raw);

    try {
      return JSON.parse(jsonStr);
    } catch {
      const preview = raw.slice(0, 200);
      throw new Error(
        `Failed to parse Claude response as JSON. Preview: ${preview}`
      );
    }
  } catch (e: any) {
    // JSON parse エラーはそのまま上へ
    if (e instanceof Error && e.message.startsWith("Failed to parse Claude"))
      throw e;

    const status: number | undefined = e?.response?.status;
    const data: AnthropicErrorBody | undefined = e?.response?.data;
    const msg =
      data?.error?.message ??
      e?.message ??
      "Unknown error calling Anthropic Messages API";

    console.error(`Anthropic API error (${status ?? "unknown"}): ${msg}`);
    if (data?.request_id) console.error(`request_id: ${data.request_id}`);

    throw e;
  }
}