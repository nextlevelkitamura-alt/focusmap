# Focusmap 計画書

> shikumika → Focusmap 方向転換計画
> 作成: 2026-04-03
> ステータス: Phase 1 準備中

---

## なぜ方向転換するのか

shikumikaは「人間がタスクを管理する前提」で作っていた。
しかし本当に必要なのは **「AIが管理・実行し、人間は俯瞰・承認する」** ダッシュボード。

Claude Codeで業務を自動化した経験から、最大の痛みは「AIが何をしたか見えない」こと。
Focusmapはこの痛みを解決するプロダクト。

---

## コアコンセプト

**「AIが働き、人間が舵を取る」ダッシュボード**

- AIレーン: AIがやったこと・やる予定 → 人間は確認・承認・指示出し
- 人間レーン: 自分がやること → AIが優先度提案・リマインド
- 統合カレンダー: 両レーンが1つのカレンダーに表示
- スキルカード: 自動化スキルが素人でもわかるカードUIで並ぶ

---

## アーキテクチャ

### 全体構成

```
Focusmap（Next.js / Vercel or Cloud Run）
  ↕ Supabase Realtime
Supabase（ai_tasks テーブル = タスクキュー）
  ↕ polling（30秒）
Mac 常駐スクリプト（task-runner）
  ↕
claude -p（Max契約内、追加コスト0円）
  → MCP、ローカルファイル、ブラウザ自動化すべて使える
```

### タスクの流れ

```
① ユーザーがFocusmapで「実行」ボタンを押す or 定時実行
② Supabase ai_tasks に INSERT（status: pending）
③ Mac常駐スクリプトが検知（30秒以内）
④ claude -p で実行（Max契約内）
⑤ 結果を Supabase に書き戻し
⑥ Focusmapが自動更新（Realtime）
⑦ 確認が必要なタスクは「確認待ち」状態で一時停止
⑧ ユーザーが承認 → 確定処理を実行
```

### タスクの3タイプ（介入レベル）

| タイプ | status の遷移 | UI |
|--------|--------------|-----|
| 自動完了 | pending → running → completed | 結果カード表示 |
| 確認待ち | pending → running → awaiting_approval → completed | 確認ボタン付きカード |
| 対話必須 | pending → running → needs_input → completed | 選択肢 or テキスト入力 |

### ai_tasks テーブル設計（案）

```sql
create table ai_tasks (
  id uuid primary key default gen_random_uuid(),
  prompt text not null,
  skill_id text,                    -- どのスキルか
  approval_type text default 'auto', -- auto / confirm / interactive
  status text default 'pending',     -- pending / running / awaiting_approval / needs_input / completed / failed
  result jsonb,
  error text,
  parent_task_id uuid references ai_tasks(id),  -- 修正指示は親タスクに紐づく
  created_at timestamptz default now(),
  started_at timestamptz,
  completed_at timestamptz
);
```

---

## スキルカード UI

素人でも「何ができるか」「今どこまで進んだか」がわかるカードUI。

### カード構成

```
┌─────────────────────────────────────┐
│ 💰 経理処理                          │
│ 「来社者の交通費・給与を自動計算」    │
│                                     │
│ ステップ:                            │
│ ① 管理画面から出勤者を取得  ✅       │
│ ② 交通費・勤務時間を計算    ✅       │
│ ③ 金額の確認               ← 今ここ │
│ ④ スプシに書き込み          ⏳       │
│                                     │
│ [▶ 実行]   最終: 昨日 17:30        │
└─────────────────────────────────────┘
```

### スキル定義ファイル（各スキルに追加）

```json
{
  "id": "claim",
  "name": "経理処理",
  "description": "来社者の交通費・給与を自動計算します",
  "icon": "💰",
  "approval_type": "confirm",
  "steps": [
    { "label": "管理画面から出勤者を取得", "auto": true },
    { "label": "交通費・勤務時間を計算", "auto": true },
    { "label": "金額の確認", "auto": false },
    { "label": "スプシに書き込み", "auto": true }
  ],
  "schedule": null,
  "prompt_template": "scripts/commute-claim を実行して..."
}
```

### 登録予定のスキル一覧

| スキル | 説明 | タイプ |
|--------|------|--------|
| 経理処理 | 来社者の交通費・給与を自動計算 | 確認待ち |
| 架電リスト更新 | 新規登録者を取得して電話リストに追加 | 確認待ち |
| LINE未読チェック | 未読メッセージを確認して一覧表示 | 自動完了 |
| 求人更新 | 求人情報を最新化 | 確認待ち |
| 管理表同期 | 候補者の管理表を最新化 | 自動完了 |
| 朝のブリーフィング | 今日の予定・タスク・要対応事項を整理 | 自動完了 |

---

## エージェントチーム構成

### 指揮官（Commander）

Focusmapの頭脳。タスクの振り分け・優先度判断・結果の品質管理を行う。

```
Commander の役割:
- ユーザーの指示を解釈し、適切なエージェントに振り分ける
- 複数タスクの実行順序を最適化
- 実行結果の品質を確認してからユーザーに提示
- エラー発生時の自動リトライ or ユーザーへの報告判断
```

### 専門エージェント

| エージェント | 役割 | 実行方法 |
|------------|------|---------|
| Executor | タスクの実行（claude -p） | Max契約内 |
| Reviewer | アプリのUI/UXを自動レビュー | Max契約内 |
| Monitor | 認証状態・システムヘルスの監視 | ローカルスクリプト |
| Scheduler | 定時タスクの管理・実行 | launchd + claude -p |

### 自動レビューシステム（Reviewer エージェント）

**目的**: Focusmapアプリ自体の品質を自動で改善する

```
Reviewer の動き:
① 定期的に（1日1回 or PR作成時）Focusmapのコードをレビュー
② 「使いやすいアプリ」の基準で評価:
   - モバイル操作性（タップターゲットのサイズ、スクロール量）
   - 情報の見やすさ（カード間隔、フォントサイズ、色のコントラスト）
   - 操作の少なさ（目的達成までのクリック数）
   - エラー時の案内（何が起きたか、何をすればいいか）
③ 改善提案をGitHub Issue or Focusmapに表示
④ 承認されたら自動でPR作成
```

**レビューのプロンプト例:**
```
このアプリを「スマホで片手操作する忙しい人」の視点でレビューしてください。
以下の基準で評価:
1. 3秒以内に目的の情報にたどり着けるか
2. ボタンは親指で押しやすいサイズか（最低44px）
3. 一画面の情報量は多すぎないか
4. 次に何をすべきか迷わないか
改善が必要な箇所をリストアップし、優先度（高/中/低）をつけてください。
```

### エージェント間の連携フロー

```
ユーザーの指示
  ↓
Commander（指揮官）
  ├── 「経理やって」→ Executor → claude -p で経理スキル実行
  ├── 「画面見づらい」→ Reviewer → コードレビュー → 改善PR
  ├── 認証切れ検知 → Monitor → ユーザーに通知
  └── 毎朝9時 → Scheduler → 朝のブリーフィング実行
```

---

## 認証管理

### 原則
- 認証情報はMac上のみ。Webアプリには一切置かない
- 切れたらFocusmapが通知。ボタン1つで再ログイン

### 認証一覧と管理方法

| サービス | 認証方式 | 保存場所 | 有効期間 | 切れた時 |
|---------|---------|---------|---------|---------|
| 管理画面 | Cookie | auth.json | 数日〜1週間 | ブラウザ表示→手動ログイン |
| Google | OAuth | gws CLI | 長期（自動更新） | 稀。gws auth で再認証 |
| LINE | APIトークン | .env | 長期 | 手動更新（稀） |
| Claude Code | OAuth | Max契約 | 不安定（失効報告あり） | claude auth login |
| Supabase | APIキー | .env | 無期限 | — |

### ヘルスチェック（Monitor エージェント）

```
5分ごとに全認証を確認:
- 管理画面: auth.json の有効性テスト
- Google: gws calendar events list（軽いリクエスト）
- Claude: claude auth status

結果を Supabase の auth_status テーブルに書く
→ Focusmapが表示: ✅ OK / ⚠️ 要ログイン
```

### 安全策（最重要）

| 対策 | 理由 |
|------|------|
| `ANTHROPIC_API_KEY` を環境変数から削除 | あるとMax課金ではなくAPI従量課金になる。$1,800請求事例あり |
| `--max-budget-usd 2.00` を必ず付ける | 1回の暴走で最大$2に制限 |
| `--max-turns 10` を付ける | 無限ループ防止 |
| 実行前に `claude auth status` | OAuthトークン失効を検知 |

---

## フェーズ計画

### Phase 1: 見える化（4月）

**ゴール**: AIの実行結果と人間のタスクが1つの画面で見える

```
Week 1（4/7-4/11）:
- [ ] リポ名変更（shikumika-app → focusmap）
- [ ] CLAUDE.md をFocusmap用に書き換え
- [ ] 既存のマインドマップUIを整理（不要な機能を非表示に）
- [ ] スキルカードコンポーネントを作成

Week 2（4/14-4/18）:
- [ ] ai_tasks テーブルをSupabaseに作成
- [ ] ダッシュボードページを作成（スキルカード一覧 + タスク状態表示）
- [ ] Supabase Realtimeで自動更新
- [ ] スキル定義ファイル（JSON）を作成

Week 3（4/21-4/25）:
- [ ] 確認画面UI（awaiting_approval 状態のカード）
- [ ] 指示入力UI（テキスト入力 → ai_tasks INSERT）
- [ ] モバイル対応（レスポンシブ）

Week 4（4/28-5/2）:
- [ ] 統合テスト
- [ ] 認証状態表示UI
- [ ] デプロイ・動作確認
```

### Phase 2: AI実行（5月）

**ゴール**: Focusmapから指示 → AIが自動実行 → 結果がFocusmapに表示

```
Week 1:
- [ ] task-runner.ts（Mac常駐スクリプト）作成
- [ ] Supabase polling → claude -p 実行 → 結果書き戻し
- [ ] launchd登録（Mac起動時に自動起動）

Week 2:
- [ ] Commander ロジック実装（タスク振り分け・優先度判断）
- [ ] 経理スキルをFocusmap対応（最初の1つ）
- [ ] 安全策の実装（max-budget, auth check, API_KEY除去確認）

Week 3:
- [ ] 残りのスキル対応（架電リスト、LINE未読、求人更新）
- [ ] Schedulerエージェント（定時実行）
- [ ] Monitor エージェント（認証ヘルスチェック）

Week 4:
- [ ] Reviewer エージェント（自動UIレビュー）
- [ ] エージェントチーム統合テスト
- [ ] プッシュ通知（確認が必要な時にスマホに通知）
```

### Phase 3: 自律化（6月〜）

```
- [ ] Cloud Scheduled Tasks でPCオフ対応（GitHubリポ内タスク）
- [ ] Gemini Flash APIで軽い判断を低コスト化
- [ ] 学習機能（過去の実行結果からプロンプトを最適化）
- [ ] 他ユーザー対応（APIキー登録 → マルチテナント）
```

---

## 既存資産の活用

shikumikaから引き継ぐもの:
- Next.js + Supabase のインフラ
- Google Calendar 連携
- 認証（NextAuth + Supabase SSR）
- ReactFlow（マインドマップ → 将来的にタスク依存関係の可視化に転用）
- Cloud Run デプロイ設定

新しく作るもの:
- ダッシュボード（スキルカード + タスク状態）
- ai_tasks テーブル + Realtime連携
- 確認画面・指示入力UI
- task-runner.ts（Mac常駐スクリプト）
- スキル定義ファイル（JSON）
- エージェントチーム（Commander / Executor / Reviewer / Monitor / Scheduler）

---

## 技術的な制約と対策

| 制約 | 対策 |
|------|------|
| Mac起動中のみ実行可能 | 仕事中は問題なし。外出時はCloud Scheduled Tasksで軽いタスクのみ |
| OAuthトークン失効リスク | 実行前にauth check。失効時はFocusmapで通知 |
| claude -p のレスポンス時間 | 30秒polling + タスクによっては数分かかる → 進捗表示で体感を改善 |
| API課金の誤発生 | ANTHROPIC_API_KEY を環境から完全除去 + --max-budget-usd |
| スマホ操作性 | Phase 1から モバイルファーストで設計 |

---

## 成功指標

Phase 1 完了時:
- [ ] 毎日Focusmapを開いている（自分が使うプロダクトになっている）
- [ ] AIの実行結果が画面で確認できる
- [ ] スマホから操作できる

Phase 2 完了時:
- [ ] ターミナルを開かずに経理処理が完了できる
- [ ] 朝のブリーフィングが自動で届く
- [ ] 認証切れに気づける

最終目標:
- [ ] 「これ便利」と思える状態で他人に見せられる
