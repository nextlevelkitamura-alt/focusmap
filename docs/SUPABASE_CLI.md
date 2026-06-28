# Supabase CLI / Management API 使用ガイド

## 認証（アクセストークン）

Supabase access token / service role key / JWT secret は、リポジトリ内の tracked file に直接書かない。
必要な値はローカル shell、`.env.local`、GitHub Secrets、または各サービスのSecret Managerにだけ置く。

アクセストークンが必要になった時は、まずこのURLを案内する:

- https://supabase.com/dashboard/account/tokens
- 公式リファレンス: https://supabase.com/docs/reference/api/introduction

```bash
# ログイン（個人アクセストークンを使用）
supabase login --token <SUPABASE_ACCESS_TOKEN>

# または環境変数で指定（コマンド実行時）
SUPABASE_ACCESS_TOKEN="<トークン>" supabase <command>
```

> 注意: このファイル自体はgit管理対象なので、実値を書かない。例示は必ず `<SUPABASE_ACCESS_TOKEN>` / `${SUPABASE_ACCESS_TOKEN}` / `${SUPABASE_SERVICE_ROLE_KEY}` のような参照だけにする。

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
cd /Users/kitamuranaohiro/Private/projects/active/focusmap
supabase link --project-ref whsjsscgmkkkzgcwxjko
```

## ✅ マイグレーション適用（推奨: Management API経由）

**このプロジェクトでは Management API + アクセストークンでマイグレーションを適用する。**
`supabase db push` はCLI管理テーブルの同期問題が起きやすいため、基本的に使わない。

### 手順A: CLIログイン済みの場合

`supabase projects list` / `supabase migration list` が通るなら、CLI保存済みログインを使って個別SQLをManagement API経由で適用できる。
この方法は `db push` ではなく、指定SQLファイルだけを `--linked` のDBへ実行する。

```bash
cd /Users/kitamuranaohiro/Private/projects/active/focusmap
supabase projects list
supabase db query --linked --file supabase/migrations/<ファイル名>.sql
```

直接SQL適用後、`supabase migration list` のRemote欄が空のままなら、RESTでテーブル存在を確認してから履歴だけ修復する。

```bash
supabase migration repair --status applied <migration_version>
supabase migration list
```

### 手順B: `SUPABASE_ACCESS_TOKEN` を明示する場合

CLIログインが使えない場合は、事前にローカル shell へ `SUPABASE_ACCESS_TOKEN` を設定してから実行する。

```bash
test -n "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
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
  local sql=$(cat "$file")
  test -n "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
  echo "Applying: $file"
  curl -s -X POST "https://api.supabase.com/v1/projects/whsjsscgmkkkzgcwxjko/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
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
supabase migration list

# 単一SQLファイルをlinked projectへ適用（db pushではない）
supabase db query --linked --file supabase/migrations/<ファイル名>.sql

# ※ db push は管理テーブルとのズレが起きやすいため、上記の個別適用方式を優先する
```

### テーブルが存在するか確認（APIで）

```bash
test -n "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required}"
curl -s "https://whsjsscgmkkkzgcwxjko.supabase.co/rest/v1/<テーブル名>?limit=1" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

### SQLを直接実行（マイグレーションなしで単発実行）

```bash
test -n "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
curl -s -X POST "https://api.supabase.com/v1/projects/whsjsscgmkkkzgcwxjko/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "YOUR SQL HERE"}'
```

### Storageバケット作成

```bash
test -n "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required}"
curl -s -X POST "https://whsjsscgmkkkzgcwxjko.supabase.co/storage/v1/bucket" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
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
test -n "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
curl -s -X POST "https://api.supabase.com/v1/projects/whsjsscgmkkkzgcwxjko/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "CREATE TABLE IF NOT EXISTS ..."}'
```

## 環境変数（.env.local）の場所

```
/Users/kitamuranaohiro/Private/projects/active/focusmap/.env.local
```

必要なキー:
- `NEXT_PUBLIC_SUPABASE_URL` — プロジェクトURL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — 公開キー
- `SUPABASE_SERVICE_ROLE_KEY` — サービスロールキー（サーバーサイドのみ）
- `SUPABASE_ACCESS_TOKEN` — Management API / CLI login用。通常はtracked fileに置かず、必要時にshellまたは `supabase login --token <SUPABASE_ACCESS_TOKEN>` で扱う
