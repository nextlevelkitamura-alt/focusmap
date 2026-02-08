---
feature: task-delete-sync
type: feature
method: undecided
created: 2026-02-08
status: idea
---

# アイデア: タスク削除時にGoogleカレンダー予定も自動削除

## 概要
タスクを削除した際に、そのタスクに紐づいているGoogleカレンダーの予定も自動的に削除する機能。

## 背景
現在、タスクを削除してもGoogleカレンダーの予定は残ったままになる。
ユーザーがタスクを削除した場合、対応するカレンダー予定も不要になるケースが多いため、自動削除することでユーザー体験を向上させる。

## 必要なサービス
- Google Calendar API（既に実装済み）

## 必要な環境変数
- なし（既存のGoogle Calendar API環境変数を使用）

## 想定される実装内容

### 1. タスク削除時の処理フロー
```typescript
// タスク削除時の処理
async function handleDeleteTask(taskId: string) {
  // 1. タスク情報を取得（google_event_id を確認）
  const task = await fetchTask(taskId)

  // 2. google_event_id が存在する場合、カレンダーイベントを削除
  if (task.google_event_id) {
    await fetch('/api/calendar/sync-task', {
      method: 'DELETE',
      body: JSON.stringify({
        taskId,
        google_event_id: task.google_event_id
      })
    })
  }

  // 3. タスクをDBから削除
  await deleteTask(taskId)
}
```

### 2. エラーハンドリング
- カレンダー削除に失敗した場合でも、タスクは削除する
- エラーはログに記録し、ユーザーに通知（トースト等）
- 404エラー（既に削除済み）の場合はエラーとして扱わない

### 3. 修正対象ファイル
- `src/components/dashboard/center-pane.tsx` - タスク削除処理
- `src/app/api/tasks/route.ts` または新規作成 - DELETE エンドポイント
- その他、タスク削除を行っているコンポーネント

### 4. UI/UX
- タスク削除時に「カレンダー予定も削除中...」のローディング表示
- 削除完了後、「タスクとカレンダー予定を削除しました」のトースト
- エラー時は「タスクを削除しましたが、カレンダー予定の削除に失敗しました」のトースト

## 優先度
**中** - ユーザー体験の向上に寄与するが、緊急性は低い

## 懸念事項
- カレンダー削除に時間がかかる場合、タスク削除のレスポンスが遅くなる
  → 解決策: カレンダー削除を非同期で行い、タスク削除は即座に完了させる

## テストシナリオ
1. google_event_id が存在するタスクを削除 → カレンダー予定も削除される
2. google_event_id が null のタスクを削除 → タスクのみ削除される
3. カレンダー削除に失敗した場合 → タスクは削除され、エラーが通知される
4. カレンダー予定が既に削除されている場合（404） → エラーなく処理完了
