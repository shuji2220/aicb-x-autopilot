import axios from "axios";

type ClaudeMessage = { role: "user" | "assistant"; content: string };

type AnthropicErrorBody = {
  type?: string;
  error?: { type?: string; message?: string };
  request_id?: string;
};

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

    const text = res.data?.content?.[0]?.text ?? "";
    return JSON.parse(text);
  } catch (e: any) {
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