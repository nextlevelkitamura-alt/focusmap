'use client'

import { Lightbulb } from 'lucide-react'

const HINTS: Record<string, string[]> = {
  personality: [
    '働き方（フリーランス / 会社員 / 学生）',
    '生活リズム（朝型 / 夜型）',
    '性格の特徴（計画的 / 柔軟 / 慎重など）',
    'コミュニケーションの好み',
  ],
  purpose: [
    '短期目標（1-3ヶ月）',
    '中長期目標（半年〜1年）',
    '大事にしている価値観',
    '避けたいこと',
  ],
  situation: [
    '最近の出来事や変化',
    '今の悩みや課題',
    '仕事の状況',
    '気分やモチベーション',
  ],
  project_purpose: [
    '誰のどんな課題を解決するか',
    'プロジェクトのゴール',
    '差別化ポイント',
  ],
  project_status: [
    '現在のフェーズ',
    '直近でやっていること',
    'ブロッカーがあれば',
    '次のマイルストーン',
  ],
  project_insights: [
    '重要な技術選定とその理由',
    'プロダクト方針の決定事項',
    '失敗から得た教訓',
  ],
  note: [
    'AIに知っておいてほしいこと',
    '趣味、関心、スキルなど',
  ],
}

interface ContentHintProps {
  documentType: string
}

export function ContentHint({ documentType }: ContentHintProps) {
  const hints = HINTS[documentType] || HINTS.note

  return (
    <div className="rounded-xl border border-white/10 bg-[#171717] p-4 text-xs text-zinc-500">
      <div className="mb-2 flex items-center gap-1.5 font-medium text-zinc-300">
        <Lightbulb className="h-3.5 w-3.5 text-amber-300" />
        こんな内容を書くとAIが活用できます
      </div>
      <ul className="ml-5 list-disc space-y-1">
        {hints.map((hint) => (
          <li key={hint}>{hint}</li>
        ))}
      </ul>
    </div>
  )
}
