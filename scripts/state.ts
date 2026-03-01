import fs from "node:fs";
import path from "node:path";

export type HistoryMetrics = {
  like_count: number;
  retweet_count: number;
  reply_count: number;
  impression_count: number;
  quote_count: number;
  fetched_at: string;
};

export type HistoryEntry = {
  id: string;
  posted_at: string;
  tweet_id: string;
  text: string;
  revision: number;
  category?: string;
  target?: string;
  metrics?: HistoryMetrics;
};

export type State = {
  telegram: { last_update_id: number };
  pending: null | {
    id: string;
    status: "pending" | "posting" | "posted" | "failed";
    draft_text: string;
    created_at: string;
    revision: number;
  };
  history: HistoryEntry[];
  policy: {
    brand: string;
    cta_url: string;
    hashtags_max: number;
    length_hint: string;
    banned_phrases: string[];
  };
  strategy: {
    category_counts: Record<string, number>;
    target_index: number;
  };
};

const STATE_PATH = path.join(process.cwd(), "data", "state.json");

export function getStatePath(): string {
  return STATE_PATH;
}

export function readState(): State {
  const raw = fs.readFileSync(STATE_PATH, "utf-8");
  return JSON.parse(raw) as State;
}

export function writeState(state: State): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf-8");
}