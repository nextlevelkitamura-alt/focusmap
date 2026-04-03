import type { FocusmapSkill } from '@/types/skill'

/** 登録済みスキル一覧 */
export const FOCUSMAP_SKILLS: FocusmapSkill[] = [
  {
    id: 'claim',
    name: '経理処理',
    description: '来社者の交通費・給与を自動計算します',
    icon: '💰',
    approval_type: 'confirm',
    steps: [
      { label: '管理画面から出勤者を取得', auto: true },
      { label: '交通費・勤務時間を計算', auto: true },
      { label: '金額の確認', auto: false },
      { label: 'スプシに書き込み', auto: true },
    ],
    schedule: null,
    prompt_template: 'scripts/commute-claim を実行して結果を報告してください',
  },
  {
    id: 'call-list',
    name: '架電リスト更新',
    description: '新規登録者を取得して電話リストに追加',
    icon: '📞',
    approval_type: 'confirm',
    steps: [
      { label: '新規登録者を取得', auto: true },
      { label: 'リスト内容の確認', auto: false },
      { label: '電話リストに追加', auto: true },
    ],
    schedule: null,
    prompt_template: '新規登録者を管理画面から取得し、架電リストを更新してください',
  },
  {
    id: 'line-check',
    name: 'LINE未読チェック',
    description: '未読メッセージを確認して一覧表示',
    icon: '💬',
    approval_type: 'auto',
    steps: [
      { label: '未読メッセージを取得', auto: true },
      { label: '一覧を整理・表示', auto: true },
    ],
    schedule: null,
    prompt_template: 'LINE MCP で未読メッセージを取得し、一覧で表示してください',
  },
  {
    id: 'job-update',
    name: '求人更新',
    description: '求人情報を最新化',
    icon: '📋',
    approval_type: 'confirm',
    steps: [
      { label: '現在の求人情報を取得', auto: true },
      { label: '更新内容を生成', auto: true },
      { label: '更新内容の確認', auto: false },
      { label: '求人情報を反映', auto: true },
    ],
    schedule: null,
    prompt_template: '求人情報を取得し、最新化の提案をしてください',
  },
  {
    id: 'pipeline-sync',
    name: '管理表同期',
    description: '候補者の管理表を最新化',
    icon: '🔄',
    approval_type: 'auto',
    steps: [
      { label: '管理画面からデータ取得', auto: true },
      { label: '管理表を更新', auto: true },
    ],
    schedule: null,
    prompt_template: '候補者管理表を最新のデータで同期してください',
  },
  {
    id: 'morning-briefing',
    name: '朝のブリーフィング',
    description: '今日の予定・タスク・要対応事項を整理',
    icon: '☀️',
    approval_type: 'auto',
    steps: [
      { label: 'カレンダー予定を取得', auto: true },
      { label: '未完了タスクを確認', auto: true },
      { label: 'ブリーフィングを生成', auto: true },
    ],
    schedule: '0 9 * * 1-5',
    prompt_template: '今日の予定・タスク・要対応事項をまとめてブリーフィングを作成してください',
  },
]

export function getSkillById(id: string): FocusmapSkill | undefined {
  return FOCUSMAP_SKILLS.find(s => s.id === id)
}
