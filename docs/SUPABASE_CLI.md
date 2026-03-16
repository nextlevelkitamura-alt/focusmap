# Supabase CLI 使用ガイド

## 認証（アクセストークン）

```bash
# ログイン（個人アクセストークンを使用）
supabase login --token <SUPABASE_ACCESS_TOKEN>

# または環境変数で指定（コマンド実行時）
SUPABASE_ACCESS_TOKEN="<トークン>" supabase <command>
```

> **注意**: トークンはgit管理ファイルに直接書かない。このファイルは `.gitignore` 対象にすること。

## プロジェクト情報

| 項目 | 値 |
|------|-----|
| プロジェクト名 | shikumika app |
| Reference ID | `whsjsscgmkkkzgcwxjko` |
| リージョン | Southeast Asia (Singapore) |
| URL | https://whsjsscgmkkkzgcwxjko.supabase.co |

## 初回セットアップ（新しいマシン・新しいチャットで作業するとき）

```bash
# 1. ログイン
supabase login --token <アクセストークン>

# 2. プロジェクトをリンク
cd /Users/kitamuranaohiro/Private/P\ dev/shikumika-app
supabase link --project-ref whsjsscgmkkkzgcwxjko
```

## よく使うコマンド

### DB操作

```bash
# マイグレーション一覧（リモートで適用済みかを確認）
supabase migration list

# 新しいマイグレーションを作成
supabase migration new <名前>
# → supabase/migrations/YYYYMMDDHHMMSS_<名前>.sql が作成される

# リモートにプッシュ（新しいマイグレーションのみ）
SUPABASE_ACCESS_TOKEN="<トークン>" supabase db push
# ※ 既存マイグレーションが未記録の場合はエラーになることがある（下記「トラブルシューティング」参照）
```

### テーブルが存在するか確認（APIで）

```bash
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indoc2pzc2NnbWtra3pnY3d4amtvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODczODM1NywiZXhwIjoyMDg0MzE0MzU3fQ.APasqqw8dD2dV3imTKYFhF1GPhMZ4vbj6OUdGgnUkGY"
curl -s "https://whsjsscgmkkkzgcwxjko.supabase.co/rest/v1/<テーブル名>?limit=1" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}"
```

### SQLを直接実行（マイグレーションなしで単発実行）

```bash
SUPABASE_ACCESS_TOKEN="<トークン>"
curl -s -X POST "https://api.supabase.com/v1/projects/whsjsscgmkkkzgcwxjko/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "YOUR SQL HERE"}'
```

### Storageバケット作成

```bash
SERVICE_KEY="<service_role_key>"
curl -s -X POST "https://whsjsscgmkkkzgcwxjko.supabase.co/storage/v1/bucket" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"id": "bucket-name", "name": "bucket-name", "public": false}'
```

## トラブルシューティング

### `supabase db push` が失敗する場合

既存のマイグレーションがリモートDBに直接適用されていてCLIの管理テーブルに記録されていない場合、
`supabase migration repair` を使うか、Management APIで直接SQLを実行する。

```bash
# 特定のマイグレーションを「適用済み」としてマーク
supabase migration repair --status applied <migration_version>

# 例: 全マイグレーションを適用済みにマーク（注意: 慎重に）
supabase migration list | grep "^ " | awk '{print $1}' | while read v; do
  supabase migration repair --status applied "$v"
done
```

### 新しいテーブルだけ適用したい場合

Management API を使って直接SQL実行が最も確実：

```bash
SUPABASE_ACCESS_TOKEN="sbp_b878806b791cf66230e7b6e6e38884099078f5f7"
curl -s -X POST "https://api.supabase.com/v1/projects/whsjsscgmkkkzgcwxjko/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "CREATE TABLE IF NOT EXISTS ..."}'
```

## 環境変数（.env.local）の場所

```
/Users/kitamuranaohiro/Private/P dev/shikumika-app/.env.local
```

必要なキー:
- `NEXT_PUBLIC_SUPABASE_URL` — プロジェクトURL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — 公開キー
- `SUPABASE_SERVICE_ROLE_KEY` — サービスロールキー（サーバーサイドのみ）
