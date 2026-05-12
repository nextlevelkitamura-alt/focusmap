# SNS投稿メモ連携

## 目的

Focusmap を思想・体験・投稿アイデアの入口にする。
SNS投稿作成時は「SNS投稿」プロジェクトに紐付いた未使用メモだけを取得し、投稿化に使ったメモは利用済みにする。

## 運用フロー

1. Focusmap のメモ画面で音声/テキスト入力する
2. 投稿に使いたい素材はプロジェクトを「SNS投稿」にする
3. SNS投稿生成側は `project_title=SNS投稿&status=pending` で未使用メモを取得する
4. 投稿に使ったメモは `used=true` で更新する
5. Focusmap 画面では「使用済み」ボタンで表示を切り替えられる

## REST API

APIキーには `notes:read` / `notes:write` スコープが必要。

### 未使用メモを取得

```http
GET /api/v1/notes?project_title=SNS投稿&status=pending&limit=50
Authorization: Bearer sk_shikumika_xxx
```

### メモを作成

```http
POST /api/v1/notes
Authorization: Bearer sk_shikumika_xxx
Content-Type: application/json

{
  "project_title": "SNS投稿",
  "content": "AIで仕事を自動化するほど、人間側には判断軸が必要になる",
  "input_type": "text"
}
```

### 利用済みにする

```http
PATCH /api/v1/notes
Authorization: Bearer sk_shikumika_xxx
Content-Type: application/json

{
  "id": "note-id",
  "used": true
}
```

`used=true` は `status=archived` に変換される。
未使用に戻す場合は `used=false`。

## MCP

- `shikumika_note_list`
- `shikumika_note_create`
- `shikumika_note_mark_used`

SNS投稿素材を読む基本形:

```json
{
  "project_title": "SNS投稿",
  "status": "pending",
  "limit": 50
}
```
