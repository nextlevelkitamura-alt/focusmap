// AI Skills Router — ユーザーの意図を分類してSkillを選択
// 方式: キーワードマッチ（高速・確実）→ 判定不能ならnull（UIでSkill選択を促す）

export function routeToSkill(message: string): string | null {
  const text = message.toLowerCase()

  // スコアリング: 複数マッチした場合に最も関連度の高いSkillを選ぶ
  const scores: Record<string, number> = {
    scheduling: 0,
    task: 0,
    memo: 0,
    counseling: 0,
  }

  // --- scheduling ---
  const schedulingStrong = /予定|カレンダー|スケジュール/
  const schedulingMedium = /会議|打ち合わせ|ミーティング|mtg|ランチ|電話|通話/i
  const schedulingWeak = /入れて|登録|予約|午前|午後|〜時|\d+時/
  if (schedulingStrong.test(text)) scores.scheduling += 3
  if (schedulingMedium.test(text)) scores.scheduling += 2
  if (schedulingWeak.test(text)) scores.scheduling += 1

  // --- task ---
  const taskStrong = /タスク|マップに追加|マインドマップ/
  const taskMedium = /優先度|締切|期限/
  const taskWeak = /やること|todo/i
  if (taskStrong.test(text)) scores.task += 3
  if (taskMedium.test(text)) scores.task += 2
  if (taskWeak.test(text)) scores.task += 1

  // --- memo ---
  const memoStrong = /メモ.*(編集|変更|更新|整理)|メモを.*(して|する)/
  const memoMedium = /アーカイブ|処理済み|紐付け/
  if (memoStrong.test(text)) scores.memo += 3
  if (memoMedium.test(text)) scores.memo += 2

  // --- counseling ---
  const counselingStrong = /相談|悩み|つらい|しんどい|きつい|不安/
  const counselingMedium = /どうしたら|アドバイス|聞いて|モヤモヤ|ストレス/
  const counselingWeak = /最近.*(?:大変|疲れ|忙し)|困って/
  if (counselingStrong.test(text)) scores.counseling += 3
  if (counselingMedium.test(text)) scores.counseling += 2
  if (counselingWeak.test(text)) scores.counseling += 1

  // 最高スコアのSkillを選択（閾値2以上で確定）
  const entries = Object.entries(scores)
  entries.sort((a, b) => b[1] - a[1])
  const [topSkill, topScore] = entries[0]

  if (topScore >= 2) {
    return topSkill
  }

  // スコアが低い = 意図が曖昧 → null（UIでSkill選択ボタンを表示）
  return null
}
