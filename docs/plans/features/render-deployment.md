# Render.com デプロイ計画

## 📋 概要
shikumika-appをVercelからRender.comに移行するための詳細計画

## 🎯 移行目的
- 無料プランでの動作検証
- デプロイインフラの多様化
- 将来的なカスタムドメイン設定の準備

---

## 📝 Phase 1: 準備（ローカルでの確認）

### ✅ 1.1 環境変数の整理
**目的**: Vercel特有の設定を削除し、本番環境用に調整

#### 削除が必要な変数
```bash
# 不要（Vercel特有）
VERCEL_OIDC_TOKEN=xxxxxxxx
```

#### 更新が必要な変数
```bash
# 本番環境用に更新
NEXTAUTH_URL=https://shikumika-app.onrender.com
GOOGLE_REDIRECT_URI=https://shikumika-app.onrender.com/api/calendar/callback
```

#### 必須の追加変数
```bash
# Render.com用に追加（.env.local）
NEXTAUTH_SECRET=xxxxxxxx  # 新しく生成
```

**実施手順**:
1. `.env.local` の `VERCEL_OIDC_TOKEN` を削除
2. `NEXTAUTH_URL` と `GOOGLE_REDIRECT_URI` を本番用に更新
3. `NEXTAUTH_SECRET` を新しく生成して追加

### ✅ 1.2 package.json の確認
**目的**: Render.comに適したscriptsを確認

```json
{
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  }
}
```

**確認事項**:
- ✅ `build` と `start` が定義されている
- ✅ ポート指定不要（Render.comが自動で処理）
- ✅ 本番用に最適化されている

---

## 📦 Phase 2: GitHubリポジトリ準備

### ✅ 2.1 リポジトリの整理
**目的**: Render.comと連携するためにGitHubリポジトリを準備

#### 必要なファイル
- `.gitignore` に `.env.local` が含まれていることの確認
- `README.md` にデプロイ方法を追記
- GitHub Actionsのワークフローが不要なことの確認

#### .gitignore 確認ポイント
```gitignore
# 環境変数ファイル
.env.local
.env.development.local
.env.test.local
.env.production.local

# Node.js
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
```

**実施手順**:
1. GitHubリポジトリが最新の状態か確認
2. `.env.local` がコミットされていないことを確認
3. 必要であれば `.gitignore` を更新

---

## 🚀 Phase 3: Render.com設定

### ✅ 3.1 アカウント作成
1. [https://render.com](https://render.com) にアクセス
2. サインアップまたはログイン
3. GitHubアカウントで連携

### ✅ 3.2 Web Serviceの作成
1. ダッシュボードで「New +」→「Web Service」を選択
2. 「Connect a Git repository」を選択
3. shikumika-appリポジトリを選択

### ✅ 3.3 設定項目の入力

#### 基本設定
| 項目 | 値 | 備考 |
|------|-----|------|
| **Name** | `shikumika-app` | アプリ名 |
| **Region** | `Tokyo` or `Singapore` | アジア地域を選択 |
| **Branch** | `main` | メインブランチ |
| **Runtime** | `Node` | Node.jsを選択 |
| **Build Command** | `npm run build` | |
| **Start Command** | `npm start` | |
| **Instance Type** | `Free` | 無料プランで開始 |

#### 環境変数設定
Renderのダッシュボードで以下を設定：

```bash
# Supabase設定
NEXT_PUBLIC_SUPABASE_URL=https://whsjsscgmkkkzgcwxjko.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...（現行の値）

# Google Calendar API
GOOGLE_CLIENT_ID=466617344999-5nd3rrfrtrieb840f7rc1425m8d0kvev.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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

# 本番環境用URL
NEXTAUTH_URL=https://shikumika-app.onrender.com
GOOGLE_REDIRECT_URI=https://shikumika-app.onrender.com/api/calendar/callback

# NextAuthシークレット（新規生成）
NEXTAUTH_SECRET=xxxxxxxx
```

### ✅ 3.4 デプロイ実行
1. 「Create Web Service」をクリック
2. 自動でビルドとデプロイが開始
3. デプロイ完了を待つ（約2-5分）

---

## 🧪 Phase 4: 動作確認

### ✅ 4.1 基本機能確認
1. アクセスURLに接続
2. ユーザー認証が動作するか確認
3. ダッシュボードが表示されるか確認

### ✅ 4.2 ジェスチャー機能確認
**重要**: 以下の機能を特に確認する

1. **ピンチインピンチアウト**
   - 2本指タッチでズームが動作する
   - ズームレベルが50%～200%の範囲で動作する
   - スムーズな動作確認

2. **スワイプナビゲーション**
   - 左右スワイプで日付/週移動
   - 誤操作防止のための縦スクロール優先化確認

3. **ドラッグ＆ドロップ**
   - タスクのドラッグがスムーズに動作する
   - リサイズ操作が正しく動作する

### ✅ 4.3 Googleカレンダー連携確認
1. Google OAuth接続が動作する
2. カレンダー同期が動作する
3. イベントの表示・編集が動作する

---

## 🔧 Phase 5: 設定調整

### ✅ 5.1 パフォーマンス確認
- 初回アクセス時の読み込み速度
- ジェスチャー操作の反応速度
- メモリ使用量の確認（無料プランの512MB制限）

### ✅ 5.2 エラーハンドling
- エラーページの確認
- ログの確認方法の把握
- 再起動方法の確認

### ✅ 5.3 カスタムドメイン設定（オプション）
```bash
# Render.comダッシュボードで設定
Custom Domain: yourdomain.com
```

---

## 📊 リスク対策

### ⚠️ リスク1: フリープランの制約
**問題**: 15分アクセスがないとスリープ
**対策**:
- 定期的なアクセスまたはヘルスチェックスクリプト
- 必要に応じて有料プランへの移行を検討

### ⚠️ リスク2: パフォーマンス
**問題**: メモリ512MBで動作
**対策**:
- React.memoの適用
- 不必要なレンダリングの削減
- バンドルサイズの最適化

### ⚠️ リスク3: 環境変数の漏洩
**対策**:
- シークレットは絶対にコードに含めない
- Renderのダッシュボードで安全に管理

---

## 📅 実行予定

| 日程 | 作業内容 | 備考 |
|------|----------|------|
| Day 1 | 環境変数整理とGitHub準備 | ローカルでの確認 |
| Day 2 | Render.com設定とデプロイ | 初回デプロイ |
| Day 3 | 動作確認と調整 | ジェスチャー機能の確認 |
| Day 4 | 最終確認とドキュメント更新 | 本番投入準備 |

---

## 🎉 成功基準

- ✅ アプリがRender.com上で正常に動作
- ✅ すべての主要機能が動作（特にジェスチャー系）
- ✅ Googleカレンダー連携が動作
- ✅ モバイル/デスクトップ両方で表示崩れなし
- ✅ Response Timeが2秒以内

## 📝 参考資源

- [Render.com Next.jsデプロイガイド](https://render.com/docs/deploy-nextjs-app)
- [Render.com環境変数設定](https://render.com/docs/environment-variables)
- [Next.js SPA最適化](https://nextjs.org/docs/app/guides/single-page-applications)