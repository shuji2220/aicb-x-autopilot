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

export type DashboardSnapshot = {
  followers_count: number;
  following_count: number;
  tweet_count: number;
  listed_count: number;
  fetched_at: string;
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
  analysis_insight?: {
    updated_at: string;
    best_post_type: string;
    best_post_time_hint: string;
    trend_keywords: string[];
    recommendations: string[];
    raw?: unknown;
  };
  dashboard?: {
    snapshots: DashboardSnapshot[];
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