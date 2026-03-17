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

## ✅ マイグレーション適用（推奨: Management API経由）

**このプロジェクトでは Management API + アクセストークンでマイグレーションを適用する。**
`supabase db push` はCLI管理テーブルの同期問題が起きやすいため、基本的に使わない。

### 手順

```bash
# 1. SQLファイルを読み込んでAPIで実行
SUPABASE_ACCESS_TOKEN="sbp_153e6bbaf018843eafeb2f8dea524378da7761ec"
SQL=$(cat supabase/migrations/<ファイル名>.sql)

curl -s -X POST "https://api.supabase.com/v1/projects/whsjsscgmkkkzgcwxjko/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(echo "$SQL" | jq -Rs .)}"
```

### 新しいマイグレーションファイルの命名規則

```
supabase/migrations/YYYYMMDD_<説明>.sql
```

例: `supabase/migrations/20260316_create_ideal_goals.sql`

### スクリプト（一括適用）

```bash
# 単一ファイルを適用するヘルパー
apply_migration() {
  local file="$1"
  local token="sbp_153e6bbaf018843eafeb2f8dea524378da7761ec"
  local sql=$(cat "$file")
  echo "Applying: $file"
  curl -s -X POST "https://api.supabase.com/v1/projects/whsjsscgmkkkzgcwxjko/database/query" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "{\"query\": $(echo "$sql" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"
  echo ""
}

# 使用例
apply_migration supabase/migrations/20260316_create_ideal_goals.sql
```

## よく使うコマンド

### DB操作（CLIが必要な場合のみ）

```bash
# マイグレーション一覧（リモートで適用済みかを確認）
SUPABASE_ACCESS_TOKEN="sbp_153e6bbaf018843eafeb2f8dea524378da7761ec" supabase migration list

# ※ db push は管理テーブルとのズレが起きやすいため、上記Management API方式を優先する
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
SUPABASE_ACCESS_TOKEN="sbp_153e6bbaf018843eafeb2f8dea524378da7761ec"
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
