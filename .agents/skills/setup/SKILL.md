---
name: setup
description: |
  Focusmap の初期セットアップを対話的に実行する。
  「セットアップ」「setup」「初期設定」「インストール」と言ったときに使用。
---

# Focusmap セットアップスキル（/setup）

初めてこのリポジトリを使うユーザーのために、必要な環境をすべて自動で構築する。
ユーザーのスキルレベルに関係なく、対話的にガイドする。

## 実行フロー

### Step 0: 前提チェック

以下を自動で確認し、足りないものがあれば **ステップバイステップで案内** する。

```bash
# 1. Node.js
node --version  # v18以上が必要

# 2. npm / pnpm
npm --version

# 3. Git
git --version

# 4. Supabase CLI（任意）
supabase --version
```

**Node.js がない場合:**
```
Node.js がインストールされていません。
以下の手順でインストールしてください：

1. ブラウザで https://nodejs.org を開いてください
2. 「LTS」と書かれた緑のボタンをクリック
3. ダウンロードされたファイルを開いてインストール
4. インストール後、このターミナルを閉じて開き直してください
5. もう一度「セットアップして」と言ってください
```

---

### Step 1: 依存パッケージのインストール

```bash
npm install
```

---

### Step 2: 環境変数の設定

`.env.local` が存在するか確認する。

**存在しない場合:**
1. `.env.example` をコピーして `.env.local` を作成
2. ユーザーに Supabase ダッシュボードの URL を案内:
   - https://supabase.com/dashboard → プロジェクト選択 → Settings → API
3. 以下の値を聞いて `.env.local` に書き込む:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

**絶対にやらないこと:**
- `.env.local` の内容を画面に表示しない
- キーをコミットしない

---

### Step 3: データベースマイグレーション

```bash
# Supabase CLI がある場合
supabase link --project-ref <PROJECT_ID>
supabase db push
```

CLI がない場合は Supabase SQL Editor での手動実行を案内する。

---

### Step 4: AIスケジュール実行（task-runner）のセットアップ

1. `scripts/com.focusmap.task-runner.plist` 内のパスをユーザーの環境に合わせて修正
2. インストール:
```bash
cp scripts/com.focusmap.task-runner.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.focusmap.task-runner.plist
```
3. 動作確認:
```bash
launchctl list | grep focusmap
```

---

### Step 5: 開発サーバー起動

```bash
npm run dev
```

ブラウザで http://localhost:3000 を開くように案内。

---

### Step 6: 完了メッセージ

```
✅ セットアップ完了！

以下が使えるようになりました:
- Focusmap ダッシュボード (http://localhost:3000)
- AIスケジュール自動実行（毎分チェック）
- 壁打ち + 定期タスク管理

次のステップ:
- ダッシュボードの「定期タスク」タブからスキルをスケジュール登録
- 「/claim を毎日18時に実行」のように設定できます
```

---

## 重要ルール

- **ユーザーが迷ったら、選択肢を出す**（「AとBどちらですか？」）
- **コマンドを実行する前に、何をするか説明する**
- **エラーが出たら、原因と対処法を具体的に示す**
- **専門用語は避ける**（「環境変数」→「設定ファイル」、「マイグレーション」→「データベースの準備」）
- **1ステップずつ進める**（一度に全部やらない）