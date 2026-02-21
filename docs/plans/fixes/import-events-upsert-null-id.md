---
fix: import-events-upsert-null-id
type: fix
created: 2026-02-22
status: completed
---

# 修正計画: import-events upsert null id

## エラー内容
- メッセージ: `null value in column "id" of relation "tasks" violates not-null constraint`
- コード: PostgreSQL 23502
- 発生箇所: src/app/api/tasks/import-events/route.ts:156 (.upsert())

## 原因分析
- 推定原因: INSERT行（id なし）と UPDATE行（id あり）を同一の `.upsert()` に混在。
  Supabase/PostgREST は全行のカラムを統一するため、id のない行は id=null として送信され NOT NULL 制約違反。

## 修正方針
- INSERT行に `crypto.randomUUID()` で明示的に id を生成する（1行追加）

## 修正対象ファイル
- src/app/api/tasks/import-events/route.ts
