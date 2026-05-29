// 全Skill共通のプロンプト部品・レスポンス形式定義

import type { UserContextCategory } from '../index'

export interface SkillContext {
  /** 今日の日付 (YYYY-MM-DD) */
  todayDate: string
  /** 現在時刻 (HH:MM) */
  currentTime: string
  /** ユーザーコンテキスト（カテゴリ別） */
  userContext: Partial<Record<UserContextCategory, string>>
  /** ユーザーの好み (preferences JSON) */
  userPreferences: Record<string, unknown>
  /** プロジェクト一覧（文字列化済み） */
  projectsContext?: string
  /** カレンダー情報 */
  calendar?: {
    isEnabled: boolean
    defaultCalendarId: string
    defaultCalendarName: string
    calendarsContext: string
    calendarCount: number
    eventsContext?: string
    undoContext?: string
  }
  /** 空き時間データ */
  freeTimeContext?: string
  /** プロジェクトコンテキスト（AIの記憶） */
  projectContextPrompt?: string
  /** 過去の会話サマリー */
  previousSummaryContext?: string
  /** アクティブなノートの内容（メモ整理Skill用） */
  activeNoteContent?: string
  /** プロジェクト相談用: タスク構造の要約データ */
  taskSummaryContext?: string
  /** プロジェクト相談用: マインドマップ構造のツリーテキスト */
  mindmapContext?: string
  /** プロジェクト相談用: 対象プロジェクトの要約（ai_context_documents） */
  projectSummary?: string
}

/** 全Skill共通の基本ルール */
export function buildCommonRules(): string {
  return `## 対話の基本ルール
- **対話優先**: ユーザーと情報を交換しながら質の高い提案をする。選択肢を提示し、ユーザーの意思を確認してから行動する
- 予定削除は delete_calendar_event action で実行できる。必ず対象予定を特定し、ユーザー確認用の action を返す
- 外部Web検索や外部サイト調査はしない。Focusmap内のタスク・メモ・予定・マップ操作に集中する
- 親しみやすく応答する（2文以内 + options）
- 日本語で応答する`
}

/** レスポンスブロック形式の共通説明 */
export function buildResponseFormatRules(): string {
  return `## 選択肢の指定方法
\`\`\`options
[{"label": "表示テキスト", "value": "選択時に送信される値"}, ...]
\`\`\`
- 最大4つまで
- **重要**: valueにUUIDやIDを含めないこと。日本語の自然な文を使うこと
- 例: {"label": "shikumika 開発", "value": "プロジェクト「shikumika 開発」に追加"}

## アクション指定方法
\`\`\`action
{"type": "アクション名", "params": {パラメータ}, "description": "確認用の説明"}
\`\`\`
注意: actionブロックとoptionsブロックとbest_proposalブロックは同時に使わない。どれか1つのみ。`
}

/** DB変更をユーザー承認付きアクションとして返すためのレスポンス形式ルール */
export function buildToolResponseFormatRules(): string {
  return `## 選択肢の指定方法
\`\`\`options
[{"label": "表示テキスト", "value": "選択時に送信される値"}, ...]
\`\`\`
- 最大4つまで
- **重要**: valueにUUIDやIDを含めないこと。日本語の自然な文を使うこと

## アクション指定方法
DB変更が必要な場合は、即実行せず、必ず確認用の action ブロックを1つだけ返すこと。
\`\`\`action
{"type": "add_task", "params": {"title": "タスク名", "project_id": "プロジェクトID"}, "description": "確認用の説明"}
\`\`\`

利用できるアクション:
- add_task: {"title": string, "project_id"?: string, "parent_task_id"?: string}
- add_calendar_event: {"title": string, "scheduled_at": string, "estimated_time"?: number, "calendar_id"?: string, "project_id"?: string}
- delete_calendar_event: {"calendar_id": string, "event_id": string, "title": string, "start_time": string, "end_time"?: string, "delete_scope"?: "this" | "series", "recurring_event_id"?: string}
- restore_calendar_event: {"undo_id": string}
- add_mindmap_group: {"title": string, "project_id": string}
- add_mindmap_task: {"title": string, "parent_id": string, "project_id": string}
- edit_memo: {"note_id": string, "content": string}
- link_project: {"note_id": string, "project_id": string}
- archive_memo: {"note_id": string}
- update_priority: {"task_id": string, "priority": number}
- set_deadline: {"task_id": string, "scheduled_at": string, "estimated_time"?: number}

注意:
- actionブロックとoptionsブロックは同時に使わない
- delete_calendar_event はカレンダー予定専用。対象が曖昧なら action を返さず、候補を示して確認する
- 繰り返し予定の削除は、ユーザーが明示しない限り「この1回だけ」か「今後すべて」かを確認する
- restore_calendar_event は直前の削除取り消し専用。undo_id が会話内にある場合だけ使う`
}

/** コンテキスト情報ブロック */
export function buildContextBlock(ctx: SkillContext): string {
  const parts: string[] = [
    `## コンテキスト`,
    `今日の日付: ${ctx.todayDate}`,
    `現在時刻: ${ctx.currentTime}`,
    `タイムゾーン: Asia/Tokyo`,
  ]

  // ユーザーコンテキスト（カテゴリ別）
  const contextEntries = Object.entries(ctx.userContext).filter(([, v]) => v && v.trim())
  if (contextEntries.length > 0) {
    parts.push('\n## ユーザーの情報')
    for (const [category, content] of contextEntries) {
      const label = USER_CONTEXT_LABELS[category as UserContextCategory] || category
      parts.push(`### ${label}\n${content}`)
    }
  }

  // preferences
  if (ctx.userPreferences && Object.keys(ctx.userPreferences).length > 0) {
    const prefs = ctx.userPreferences
    if (prefs.preferred_time_of_day) {
      parts.push(`好みの時間帯: ${prefs.preferred_time_of_day}`)
    }
    if (Array.isArray(prefs.common_event_types) && prefs.common_event_types.length > 0) {
      parts.push(`よく登録する予定: ${(prefs.common_event_types as string[]).join(', ')}`)
    }
  }

  if (ctx.projectContextPrompt) {
    parts.push(ctx.projectContextPrompt)
  }

  if (ctx.previousSummaryContext) {
    parts.push(ctx.previousSummaryContext)
  }

  if (ctx.taskSummaryContext) {
    parts.push(ctx.taskSummaryContext)
  }

  if (ctx.calendar?.eventsContext) {
    parts.push(`\n## 参照可能なカレンダー予定\n${ctx.calendar.eventsContext}`)
  }

  if (ctx.calendar?.undoContext) {
    parts.push(`\n## 復元可能な削除履歴\n${ctx.calendar.undoContext}`)
  }

  return parts.join('\n')
}

const USER_CONTEXT_LABELS: Record<UserContextCategory, string> = {
  life_personality: '生活スタイル・性格',
  life_purpose: '人生の目的・価値観',
  current_situation: '最近の状況',
}
