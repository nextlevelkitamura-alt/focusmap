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
}

/** 全Skill共通の基本ルール */
export function buildCommonRules(): string {
  return `## 対話の基本ルール
- **対話優先**: ユーザーと情報を交換しながら質の高い提案をする。選択肢を提示し、ユーザーの意思を確認してから行動する
- 削除操作は実行不可。「削除はアプリから直接行ってください」と案内する
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

## アクション指定方法
\`\`\`action
{"type": "アクション名", "params": {パラメータ}, "description": "確認用の説明"}
\`\`\`
注意: actionブロックとoptionsブロックとbest_proposalブロックは同時に使わない。どれか1つのみ。`
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

  return parts.join('\n')
}

const USER_CONTEXT_LABELS: Record<UserContextCategory, string> = {
  life_personality: '生活スタイル・性格',
  life_purpose: '人生の目的・価値観',
  current_situation: '最近の状況',
}
