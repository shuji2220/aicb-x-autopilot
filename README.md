# aicb-x-autopilot

@PD09767678（CTO・堀本修治）の個人 X アカウント自動運用システム。

Claude AI による下書き生成 → Telegram での承認フロー → X への自動投稿を実現する。

---

## システム概要

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Actions (定期実行)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐                        ┌─────────────┐         │
│  │ generate.yml│                        │ dashboard.yml│         │
│  │ JST 17:00   │                        │ JST 09:40   │         │
│  └──────┬──────┘                        └──────┬──────┘         │
│         │                                      │                │
│         ▼                                      ▼                │
│  ┌─────────────┐                        ┌─────────────┐         │
│  │ generate.ts │                        │ dashboard.ts│         │
│  │ ツイート    │                        │ メトリクス  │         │
│  │ 下書き生成  │                        │ 収集       │         │
│  └──────┬──────┘                        └─────────────┘         │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────┐                                            │
│  │   state.json    │                                            │
│  │ (pending に保存) │                                            │
│  └────────┬────────┘                                            │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐                                            │
│  │    Telegram     │                                            │
│  │   下書き通知     │                                            │
│  └────────┬────────┘                                            │
│           │                                                     │
└───────────│─────────────────────────────────────────────────────┘
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
│                    GitHub Actions                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐                                            │
│  │    watch.yml    │                                            │
│  │ Telegram監視    │                                            │
│  │ (generate完了後 │                                            │
│  │  に起動)        │                                            │
│  └────────┬────────┘                                            │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐         ┌─────────────────┐                │
│  │    watch.ts     │────────▶│     X API       │                │
│  │ コマンド処理     │         │   投稿実行      │                │
│  └─────────────────┘         └─────────────────┘                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## ディレクトリ構成

```
aicb-x-autopilot/
├── .github/workflows/       # GitHub Actions ワークフロー
│   ├── generate.yml         # ツイート下書き生成 (JST 17:00)
│   ├── watch.yml            # Telegram コマンド監視 (generate 完了後に起動)
│   ├── dashboard.yml        # アカウントメトリクス収集 (JST 09:40)
│   └── report.yml           # 週次レポート生成 (日曜 JST 09:00)
│
├── scripts/                 # TypeScript スクリプト
│   ├── generate.ts          # ツイート下書き生成
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

### 1. ツイート生成 (`npm run generate`)

- **実行タイミング**: JST 17:00 (UTC 08:00)
- **処理フロー**:
  1. カテゴリ（ai_news/ai_tips/cto_thought/industry_trend/tool_review）をローテーションで選択
  2. ターゲット（エンジニア・開発者/AIビジネスパーソン/スタートアップ・起業家/IT業界全般）をローテーションで選択
  3. Claude に下書き生成を依頼
  4. `state.pending` に保存
  5. Telegram に通知

- **カテゴリ配分**:
  - ai_news（AI業界ニュース・トレンド紹介）: 30%
  - ai_tips（AIプロンプト活用Tips）: 25%
  - cto_thought（CTO・起業家視点の断言）: 20%
  - industry_trend（テック業界の潮流分析）: 15%
  - tool_review（AIツール・サービス紹介）: 10%

### 2. Telegram コマンド監視 (`npm run watch`)

- **実行タイミング**: Generate Draft の完了後に自動起動（10分間隔×最大6回）
- **対応コマンド**:
  - `/approve [id]` - 下書きを承認して投稿
  - `/revise [id] [指示]` - 修正を依頼（最大2回）
  - `/reject [id]` - 下書きを却下
- **自動却下**: 1時間応答なしで自動却下

### 3. ダッシュボード (`npm run dashboard`)

- **実行タイミング**: JST 09:40 (UTC 00:40)
- **処理内容**: アカウントのフォロワー数等を `state.dashboard.snapshots` に記録

### 4. 週次レポート (`npm run report`)

- **実行タイミング**: 毎週日曜 JST 09:00 (UTC 00:00)
- **処理内容**: 過去投稿のメトリクスを取得し、Claude で分析、Telegram にレポート送信

---

## state.json 構造

```typescript
type State = {
  telegram: { last_update_id: number };
  pending: null | {
    id: string;                    // 日付ベースID (例: "2026-03-13")
    status: "pending" | "posting" | "posted" | "failed";
    draft_text: string;            // 下書き本文
    created_at: string;            // ISO8601
    revision: number;              // 修正回数 (最大2)
  };
  history: HistoryEntry[];         // 投稿履歴
  policy: {
    brand: string;                 // "堀本修治 / @PD09767678"
    cta_url: string;               // "" (未使用)
    hashtags_max: number;
    length_hint: string;           // "120字まで"
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
npm run generate    # ツイート下書き生成
npm run watch       # Telegram コマンド監視
npm run dashboard   # メトリクス収集
npm run report      # 週次レポート
```

---

## 投稿フロー

```
generate.ts → pending に保存 → Telegram 通知
    ↓
ユーザー: /approve [id]
    ↓
watch.ts → postTweet() → X に投稿 → history に記録
```

---

## 注意事項

- `state.json` は GitHub Actions でコミット・プッシュされる
- `concurrency: state-update` で同時実行を防止
- pending が残っている間は新規生成をスキップ
