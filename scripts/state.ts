import fs from "node:fs";
import path from "node:path";

export type State = {
  telegram: { last_update_id: number };
  pending: null | {
    id: string;
    status: "pending" | "posting";
    draft_text: string;
    created_at: string;
    revision: number;
  };
  history: any[];
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

export function readState(): State {
  const raw = fs.readFileSync(STATE_PATH, "utf-8");
  return JSON.parse(raw) as State;
}

export function writeState(state: State): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf-8");
}