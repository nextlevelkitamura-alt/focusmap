// AI Skills レジストリ
// 各Skillはラベル・アイコン・必要コンテキスト・依存データを定義

export type UserContextCategory = 'life_personality' | 'life_purpose' | 'current_situation'

export interface SkillDefinition {
  id: string
  label: string
  icon: string            // lucide-react アイコン名
  description: string
  /** このSkillが参照するユーザーコンテキストのカテゴリ */
  contextCategories: UserContextCategory[]
  /** カレンダー連携データが必要か */
  needsCalendar: boolean
  /** プロジェクト一覧が必要か */
  needsProjects: boolean
  /** 空き時間データが必要か */
  needsFreeTime: boolean
}

export const SKILLS: SkillDefinition[] = [
  {
    id: 'scheduling',
    label: '予定を入れる',
    icon: 'CalendarPlus',
    description: 'カレンダーに予定を追加・調整',
    contextCategories: ['life_personality'],
    needsCalendar: true,
    needsProjects: false,
    needsFreeTime: true,
  },
  {
    id: 'task',
    label: 'タスク管理',
    icon: 'ListTodo',
    description: 'マップにタスクを追加・優先度変更',
    contextCategories: ['current_situation'],
    needsCalendar: false,
    needsProjects: true,
    needsFreeTime: false,
  },
  {
    id: 'counseling',
    label: '相談する',
    icon: 'MessageCircleHeart',
    description: 'あなたの状況や悩みを一緒に整理',
    contextCategories: ['life_personality', 'life_purpose', 'current_situation'],
    needsCalendar: false,
    needsProjects: false,
    needsFreeTime: false,
  },
]

export function getSkillById(id: string): SkillDefinition | undefined {
  return SKILLS.find(s => s.id === id)
}
