export type Category = "usecase" | "success" | "prompt" | "vision" | "devlog";

export const CATEGORY_LABEL: Record<Category, string> = {
  usecase: "実用ユースケース",
  success: "実際に役立った例・売れた例",
  prompt: "プロンプト断片",
  vision: "世界観",
  devlog: "開発ログ",
};

export const TARGETS = [
  "エンジニア関係のアカウント",
  "経営者のアカウント",
  "IT関係のアカウント",
  "デザイン関係のアカウント",
  "ライターのアカウント",
] as const;

export function buildDraftSystem(params: {
  brand: string;
  ctaUrl: string;
  hashtagsMax: number;
  lengthHint: string;
  bannedPhrases: string[];
}) {
  const { brand, ctaUrl, hashtagsMax, lengthHint, bannedPhrases } = params;

  return `
あなたはX運用のプロ編集者です。目的は「AICB専用アカウントで、宣伝臭を抑えつつ有益な投稿でフォローを増やす」こと。
必ず日本語。誇大広告は禁止。JSONのみを返す。

制約:
- 文字数目安: ${lengthHint}
- URLは必ず最後の1行に1回だけ: ${ctaUrl}
- ハッシュタグは最大${hashtagsMax}個（0でも可）
- 絵文字は少なめ
- 禁止フレーズ（含めない）: ${bannedPhrases.join(", ")}

出力フォーマット（JSONのみ）:
{
  "title": "下書きの狙い（短く）",
  "draft_text": "Xに投稿する本文（改行含む）",
  "category": "usecase|success|prompt|vision|devlog",
  "target": "今回の主ターゲット",
  "notes": ["チェックポイント1", "2"]
}
`.trim();
}

export function buildDraftUser(params: {
  category: Category;
  target: string;
  recentPosts: string[];
  ctaUrl: string;
}) {
  const { category, target, recentPosts, ctaUrl } = params;

  const recent = recentPosts.length
    ? recentPosts.map((p, i) => `- (${i + 1}) ${p}`).join("\n")
    : "- なし";

  return `
今日作る投稿カテゴリ: ${category}（${CATEGORY_LABEL[category]}）
今回の主ターゲット: ${target}

直近の投稿（重複回避。言い回し・冒頭・構成が被らないように）:
${recent}

必須:
- 最後の行にこのURLを必ず入れる: ${ctaUrl}
- 宣伝のための説明だけにせず、読者が「保存したくなる」具体を入れる
- 1行目はベネフィットが伝わる言い切り（煽りすぎない）

では、指定カテゴリ・ターゲットに最適化した下書きを1本作ってください。
`.trim();
}