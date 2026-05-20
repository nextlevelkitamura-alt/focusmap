# SNS投稿メモAPI

Focusmap のメモを、SNS投稿の素材ストックとして使うためのAPI。

このドキュメントは人間・AIエージェントの両方に読ませる前提で書いている。単なるエンドポイント表ではなく、「どの順番で何をするか」まで含める。

## AIに渡すもの

他のAIにSNS投稿案、スプレッドシート分析、投稿台帳入力のフローを考えさせる場合は、以下を渡す。

1. `GET /llms.txt`
   - FocusmapのAI向けドキュメント索引。
2. `GET /llms-full.txt`
   - SNS投稿メモAPIの使い方をまとめたAI向け全文。
3. `GET /openapi.json`
   - `/api/v1/notes` の機械可読なAPI仕様。
4. APIキー
   - `notes:read` はメモ取得に必要。
   - `notes:write` はメモ作成・利用済み化に必要。

`docs/` 配下はリポジトリ内の正本であり、Web URLでは直接公開されない。外部AIには `public/` 配下から配信される `/llms.txt`、`/llms-full.txt`、`/openapi.json` を読ませる。

## 基本コンセプト

- Focusmapは入口: 音声・テキストで思いつきを雑に入れる。
- `SNS投稿` プロジェクトは投稿素材の箱: 投稿に使いたいメモだけ紐付ける。
- `status=pending` は未使用素材。
- `status=archived` は利用済み素材。
- `used=true` は `status=archived` に変換される。
- `used=false` は `status=pending` に戻す。

## 標準フロー

### 1. 未使用のSNS投稿メモを取得する

```http
GET /api/v1/notes?project_title=SNS投稿&status=pending&limit=50
Authorization: Bearer sk_shikumika_xxx
```

使いどころ:

- 投稿案を作る前
- スプレッドシートの「ネタ帳」に入れる候補を探す時
- 投稿管理シートに投入する前の素材レビュー

期待レスポンス:

```json
{
  "success": true,
  "data": [
    {
      "id": "note-id",
      "project_id": "project-id",
      "content": "AIで仕事を自動化するほど、人間側には判断軸が必要になる",
      "raw_input": null,
      "input_type": "text",
      "status": "pending",
      "ai_analysis": null,
      "created_at": "2026-05-12T13:00:00.000Z",
      "updated_at": "2026-05-12T13:00:00.000Z"
    }
  ]
}
```

### 2. 投稿案・台帳入力に使う

AIは `content` を素材として使う。

推奨処理:

- 1メモ = 1つの思想・体験・問いとして扱う。
- 投稿化する時は、メモの主張を薄めすぎない。
- 外部リサーチを足す場合も、メモの個人的視点を主語にする。
- スプレッドシートへ入れる場合は、元メモIDを残せるなら残す。

### 3. 使ったメモを利用済みにする

```http
PATCH /api/v1/notes
Authorization: Bearer sk_shikumika_xxx
Content-Type: application/json

{
  "id": "note-id",
  "used": true
}
```

これにより `status` は `archived` になる。

重要:

- `archived` は削除ではない。
- `archived` は「投稿素材として一度使った」という意味。
- 再利用したい時は `used=false` で未使用に戻せる。

### 4. 未使用に戻す

```http
PATCH /api/v1/notes
Authorization: Bearer sk_shikumika_xxx
Content-Type: application/json

{
  "id": "note-id",
  "used": false
}
```

## メモを新規作成する

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

`project_title` に `SNS投稿` を指定すると、プロジェクトIDを知らなくても紐付けられる。

## 検索・絞り込み

### 音声メモだけ取得

```http
GET /api/v1/notes?project_title=SNS投稿&status=pending&input_type=voice
Authorization: Bearer sk_shikumika_xxx
```

### キーワード検索

```http
GET /api/v1/notes?project_title=SNS投稿&status=pending&q=AI
Authorization: Bearer sk_shikumika_xxx
```

### 利用済みも含めて見る

```http
GET /api/v1/notes?project_title=SNS投稿&include_archived=true
Authorization: Bearer sk_shikumika_xxx
```

## MCPツール

Focusmap MCPが使える環境では、REST APIよりMCPツールを優先してよい。

- `shikumika_note_list`
  - SNS投稿素材は `project_title: "SNS投稿", status: "pending"` で取得する。
- `shikumika_note_create`
  - Focusmapにメモを追加する。
- `shikumika_note_mark_used`
  - 使ったメモを利用済みにする。

## AIエージェントへの指示テンプレート

```text
FocusmapのSNS投稿メモAPIを使ってください。

読む順番:
1. /llms.txt
2. /llms-full.txt
3. /openapi.json

作業ルール:
- 投稿素材は /api/v1/notes?project_title=SNS投稿&status=pending で取得する
- 投稿案、スプレッドシート入力、投稿台帳化に使ったメモは PATCH /api/v1/notes で used=true にする
- used=true は削除ではなく「利用済み」チェック
- メモ本文の個人的視点を残して投稿化する
- APIキーには notes:read / notes:write が必要
```

## 注意

外部AIにAPIキーを渡す場合は、必要なスコープだけを付ける。
読み取りだけなら `notes:read`、利用済み化まで任せるなら `notes:write` も付ける。
