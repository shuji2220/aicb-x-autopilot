/**
 * analyze.ts — 投稿成績の分析ユーティリティ。
 * generate.ts のプロンプトに注入するサマリーを生成する。
 */
import { HistoryEntry } from "./state";

export type PostScore = {
  id: string;
  text: string;
  category?: string;
  target?: string;
  impressions: number;
  likes: number;
  engagementRate: number; // (likes + RTs + replies + quotes) / impressions
};

function scoreEntry(h: HistoryEntry): PostScore | null {
  if (!h.metrics) return null;
  const m = h.metrics;
  const imps = m.impression_count || 0;
  const engagement = m.like_count + m.retweet_count + m.reply_count + m.quote_count;
  return {
    id: h.id,
    text: h.text,
    category: h.category,
    target: h.target,
    impressions: imps,
    likes: m.like_count,
    engagementRate: imps > 0 ? engagement / imps : 0,
  };
}

/**
 * メトリクス付きの履歴からベスト/ワーストを抽出し、
 * Claude に渡せるテキストサマリーを返す。
 * メトリクスがなければ null を返す。
 */
export function buildPerformanceSummary(history: HistoryEntry[]): string | null {
  const scored = history
    .map(scoreEntry)
    .filter((s): s is PostScore => s !== null && s.impressions > 0);

  if (scored.length === 0) return null;

  // インプレッション順にソート
  const byImps = [...scored].sort((a, b) => b.impressions - a.impressions);
  // エンゲージメント率順
  const byEng = [...scored].sort((a, b) => b.engagementRate - a.engagementRate);

  const top3 = byImps.slice(0, 3);
  const worst = byImps.length >= 3 ? byImps.slice(-1) : [];
  const bestEng = byEng.slice(0, 2);

  // 全体平均
  const totalImps = scored.reduce((s, p) => s + p.impressions, 0);
  const totalLikes = scored.reduce((s, p) => s + p.likes, 0);
  const avgImps = Math.round(totalImps / scored.length);
  const avgLikes = +(totalLikes / scored.length).toFixed(1);
  const avgEng = +(scored.reduce((s, p) => s + p.engagementRate, 0) / scored.length * 100).toFixed(2);

  const lines: string[] = [];
  lines.push(`過去${scored.length}件の投稿成績（メトリクス取得済み分）:`);
  lines.push(`平均: インプレッション=${avgImps}, いいね=${avgLikes}, エンゲージメント率=${avgEng}%`);

  lines.push("");
  lines.push("【好成績 TOP3（インプレッション順）】");
  for (const p of top3) {
    const head = p.text.replace(/\s+/g, " ").slice(0, 50);
    lines.push(`- 👁${p.impressions} ❤️${p.likes} eng=${(p.engagementRate * 100).toFixed(1)}% | ${head}…`);
  }

  if (bestEng.length > 0) {
    lines.push("");
    lines.push("【高エンゲージメント率 TOP2】");
    for (const p of bestEng) {
      const head = p.text.replace(/\s+/g, " ").slice(0, 50);
      lines.push(`- eng=${(p.engagementRate * 100).toFixed(1)}% 👁${p.impressions} | ${head}…`);
    }
  }

  if (worst.length > 0) {
    lines.push("");
    lines.push("【低成績（改善のヒントに）】");
    for (const p of worst) {
      const head = p.text.replace(/\s+/g, " ").slice(0, 50);
      lines.push(`- 👁${p.impressions} ❤️${p.likes} | ${head}…`);
    }
  }

  return lines.join("\n");
}
