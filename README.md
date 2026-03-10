# aicb-x-autopilot

AI Contents Bank の X (Twitter) アカウント自動運用システム。

Claude AI による下書き生成 → Telegram での承認フロー → X への自動投稿を実現する。

---

## システム概要

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Actions (定期実行)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ generate.yml│    │  quote.yml  │    │ dashboard.yml│         │
│  │ JST 17:00   │    │ JST 10:00   │    │ JST 09:40   │         │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘         │
│         │                  │                  │                 │
│         ▼                  ▼                  ▼                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ generate.ts │    │  quote.ts   │    │ dashboard.ts│         │
│  │ 通常ツイート │    │ 引用ツイート │    │ メトリクス  │         │
│  │ 下書き生成  │    │ 下書き生成  │    │ 収集       │         │
│  └──────┬──────┘    └──────┬──────┘    └─────────────┘         │
│         │                  │                                    │
│         └────────┬─────────┘                                    │
│                  ▼                                              │
│         ┌─────────────────┐                                     │
│         │   state.json    │                                     │
│         │ (pending に保存) │                                     │
│         └────────┬────────┘                                     │
│                  │                                              │
│                  ▼                                              │
│         ┌─────────────────┐                                     │
│         │    Telegram     │                                     │
│         │   下書き通知     │                                     │
│         └────────┬────────┘                                     │
│                  │                                              │
└──────────────────│──────────────────────────────────────────────┘
                   │
                   ▼ ユーザー操作
         ┌─────────────────┐
         │ /approve [id]   │ → 承認
         │ /revise [id] .. │ → 修正依頼
         │ /reject [id]    │ → 却下
         └────────┬────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Actions (5分毎)                        │
├─────────────────────────────────────────────────────────────────┤
│         ┌─────────────────┐                                     │
│         │    watch.yml    │                                     │
│         │ Telegram監視    │                                     │
│         └────────┬────────┘                                     │
│                  │                                              │
│                  ▼                                              │
│         ┌─────────────────┐         ┌─────────────────┐         │
│         │    watch.ts     │────────▶│     X API       │         │
│         │ コマンド処理     │         │   投稿実行      │         │
│         └─────────────────┘         └─────────────────┘         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## ディレクトリ構成

```
aicb-x-autopilot/
├── .github/workflows/       # GitHub Actions ワークフロー
│   ├── generate.yml         # 通常ツイート下書き生成 (JST 17:00)
│   ├── quote.yml            # 引用ツイート下書き生成 (JST 10:00)
│   ├── watch.yml            # Telegram コマンド監視 (5分毎)
│   ├── dashboard.yml        # アカウントメトリクス収集 (JST 09:40)
│   └── report.yml           # 週次レポート生成 (日曜 JST 09:00)
│
├── scripts/                 # TypeScript スクリプト
│   ├── generate.ts          # 通常ツイート下書き生成
│   ├── quote.ts             # 引用ツイート下書き生成
│   ├── watch.ts             # Telegram コマンド監視・投稿実行
│   ├── report.ts            # 週次レポート生成
│   ├── dashboard.ts         # アカウントメトリクス収集
│   ├── analyze.ts           # パフォーマンス分析
│   ├── prompts.ts           # Claude プロンプト定義
│   ├── claude.ts            # Claude API 呼び出し
│   ├── telegram.ts          # Telegram API 呼び出し
│   ├── x.ts                 # X (Twitter) API 呼び出し
│   ├── x_text.ts            # ツイート文字数計算・短縮
│   ├── x_debug.ts           # X API デバッグ用
│   └── state.ts             # state.json 読み書き・型定義
│
├── data/
│   └── state.json           # 状態管理ファイル
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## 機能一覧

### 1. 通常ツイート生成 (`npm run generate`)

- **実行タイミング**: JST 17:00 (UTC 08:00)
- **処理フロー**:
  1. カテゴリ（usecase/success/prompt/vision/devlog）をローテーションで選択
  2. ターゲット（エンジニア/経営者/IT/デザイン/ライター）をローテーションで選択
  3. Claude に下書き生成を依頼
  4. `state.pending` に保存
  5. Telegram に通知

### 2. 引用ツイート生成 (`npm run quote`)

- **実行タイミング**: JST 10:00 (UTC 01:00)
- **処理フロー**:
  1. X API で AI 関連ツイートを検索
  2. フィルタリング（フォロワー数、認証状態、プロフィール）
  3. スコアリング（いいね×2 + RT×3）で上位1件を選択
  4. Claude に引用コメント生成を依頼
  5. `state.pending` に保存（`quote_tweet_id` 付き）
  6. Telegram に通知

### 3. Telegram コマンド監視 (`npm run watch`)

- **実行タイミング**: 5分毎
- **対応コマンド**:
  - `/approve [id]` - 下書きを承認して投稿
  - `/revise [id] [指示]` - 修正を依頼（引用ツイートは非対応）
  - `/reject [id]` - 下書きを却下
- **自動却下**: 1時間応答なしで自動却下

### 4. ダッシュボード (`npm run dashboard`)

- **実行タイミング**: JST 09:40 (UTC 00:40)
- **処理内容**: アカウントのフォロワー数等を `state.dashboard.snapshots` に記録

### 5. 週次レポート (`npm run report`)

- **実行タイミング**: 毎週日曜 JST 09:00 (UTC 00:00)
- **処理内容**: 過去投稿のメトリクスを取得し、Claude で分析、Telegram にレポート送信

---

## state.json 構造

```typescript
type State = {
  telegram: { last_update_id: number };
  pending: null | {
    id: string;                    // 日付ベースID (例: "2026-03-11" or "2026-03-11-quote")
    status: "pending" | "posting" | "posted" | "failed";
    draft_text: string;            // 下書き本文
    created_at: string;            // ISO8601
    revision: number;              // 修正回数 (最大2)
    quote_tweet_id?: string;       // 引用ツイートの場合のみ
    quote_tweet_url?: string;      // 引用ツイートの場合のみ
  };
  history: HistoryEntry[];         // 投稿履歴
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
  analysis_insight?: { ... };      // AI 分析結果
  dashboard?: {
    snapshots: DashboardSnapshot[];
  };
};
```

---

## 環境変数 (GitHub Secrets)

| 変数名 | 説明 |
|--------|------|
| `ANTHROPIC_API_KEY` | Claude API キー |
| `ANTHROPIC_MODEL` | Claude モデル名 |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot トークン |
| `TELEGRAM_CHAT_ID` | 通知先チャット ID |
| `X_API_KEY` | X API Key |
| `X_API_KEY_SECRET` | X API Key Secret |
| `X_ACCESS_TOKEN` | X Access Token |
| `X_ACCESS_TOKEN_SECRET` | X Access Token Secret |

---

## ローカル開発

```bash
# 依存関係インストール
npm install

# 環境変数設定
cp .env.example .env
# .env を編集

# 各スクリプト実行
npm run generate    # 通常ツイート下書き生成
npm run quote       # 引用ツイート下書き生成
npm run watch       # Telegram コマンド監視
npm run dashboard   # メトリクス収集
npm run report      # 週次レポート
```

---

## 投稿フロー詳細

### 通常ツイート

```
generate.ts → pending に保存 → Telegram 通知
    ↓
ユーザー: /approve [id]
    ↓
watch.ts → postTweet() → X に投稿 → history に記録
```

### 引用ツイート

```
quote.ts → X 検索 → フィルタ → Claude 生成 → pending に保存 → Telegram 通知
    ↓
ユーザー: /approve [id]
    ↓
watch.ts → postQuoteTweet() → X に引用投稿 → history に記録
```

---

## 注意事項

- `state.json` は GitHub Actions でコミット・プッシュされる
- `concurrency: state-update` で同時実行を防止
- pending が残っている間は新規生成をスキップ
- 引用ツイートは `/revise` 非対応（`/reject` して再生成）
