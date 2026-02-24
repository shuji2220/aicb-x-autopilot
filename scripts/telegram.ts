import axios from "axios";

type SendMessageOptions = {
  disable_web_page_preview?: boolean;
};

export async function sendTelegramMessage(params: {
  botToken: string;
  chatId: string;
  text: string;
  options?: SendMessageOptions;
}): Promise<void> {
  const { botToken, chatId, text, options } = params;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await axios.post(url, {
    chat_id: chatId,
    text,
    disable_web_page_preview: options?.disable_web_page_preview ?? true,
  });
}

export async function getTelegramUpdates(params: {
  botToken: string;
  offset?: number;
  timeoutSec?: number;
}): Promise<any> {
  const { botToken, offset, timeoutSec } = params;

  const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
  const res = await axios.get(url, {
    params: {
      offset,
      timeout: timeoutSec ?? 0,
      allowed_updates: ["message"],
    },
  });
  return res.data;
}