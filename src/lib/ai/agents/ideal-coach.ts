/**
 * 理想コーチエージェント — プロンプトビルダー
 * Phase 3: ideal-coach スキルに特化したコーチングプロンプト
 *
 * 使用コンテキスト:
 * - Layer4（ビジョン層）: life_personality / life_purpose
 * - Layer2（タスク層）: current_situation + freshnessAlerts
 * - ideal_goals / ideal_items データ
 */

interface IdealCoachContextInjection {
  userContextCategories: Partial<Record<'life_personality' | 'life_purpose' | 'current_situation', string>>
  freshnessAlerts: string
}

/**
 * 理想コーチ専用システムプロンプトを構築する
 *
 * @param contextInjection - loadContextFromDocuments の結果（Layer4 + Layer2 に相当）
 * @param idealGoalsContext - 理想像データのフォーマット済みテキスト
 */
export function buildIdealCoachSystemPrompt(
  contextInjection: IdealCoachContextInjection,
  idealGoalsContext: string,
): string {
  const { userContextCategories, freshnessAlerts } = contextInjection

  // Layer4: ビジョン・性格
  const layer4Parts: string[] = []
  if (userContextCategories.life_personality) {
    layer4Parts.push(`【性格・生活スタイル】\n${userContextCategories.life_personality}`)
  }
  if (userContextCategories.life_purpose) {
    layer4Parts.push(`【価値観・ビジョン】\n${userContextCategories.life_purpose}`)
  }
  const layer4Block = layer4Parts.length > 0
    ? `\n## ユーザーの価値観・ビジョン（長期）\n${layer4Parts.join('\n\n')}`
    : ''

  // Layer2: 現在の状況
  const layer2Parts: string[] = []
  if (userContextCategories.current_situation) {
    layer2Parts.push(userContextCategories.current_situation)
  }
  if (freshnessAlerts) {
    layer2Parts.push(freshnessAlerts)
  }
  const layer2Block = layer2Parts.length > 0
    ? `\n## 現在の状況（直近）\n${layer2Parts.join('\n\n')}`
    : ''

  // 理想像データ
  const idealBlock = idealGoalsContext
    ? `\n## ユーザーの理想像（ビジョンボード）\n${idealGoalsContext}`
    : '\n## ユーザーの理想像\nまだ理想像が登録されていません。まずは「どんな自分になりたいか」を一緒に考えましょう。'

  const contextUpdateSection = `## context_update の返し方
ユーザーの回答から新しい情報が得られたら以下の形式で更新してください:
\`\`\`context_update
{"category":"life_purpose","content":"抽出した要約テキスト（333字以内）"}
\`\`\`

カテゴリの使い分け:
- **life_purpose**: 人生の目標、大事にしている価値観、なりたい姿、キャリアの方向性
- **life_personality**: 生活リズム、性格、仕事スタイル、コミュニケーションの傾向
- **current_situation**: 最近の仕事内容、悩み、ストレス、生活の変化、直近の課題

ルール:
- context_update は1回の応答で1つまで
- 既存情報がある場合は追記・統合する形で書く（上書きではない）
- 333字以内に収める
- context_update を返すときも reply は必ず返す`

  const optionsSection = `## 選択肢の指定方法
\`\`\`options
[{"label": "表示テキスト", "value": "選択時に送信される値"}, ...]
\`\`\`
- 最大4つまで
- 次の問いかけに自然につながる選択肢を用意する
- 「もっと深掘りしたい」「別の理想について話す」などの開いた選択肢も有効`

  return `あなたは「しくみか」の理想像コーチです。
ユーザーが設定した「なりたい自分」（理想像）をもとに、壁打ち・コーチングを行います。

## 基本姿勢
- ユーザーの理想像を否定せず、実現可能性を一緒に探る
- 「本当にそれがやりたいの？」ではなく「それを実現したらどんな気持ち？」と問いかける
- 理想と現実のギャップを責めるのではなく、小さな一歩を一緒に見つける
- 一度に聞くのは1つの問いだけ（シンプルに、深く）
- 日本語で応答する
- 返答は2〜4文 + 選択肢 が基本

## コーチング進行ルール
1. **理想像の確認・深掘り**: 「その理想のどこに一番惹かれますか？」で本質的な欲求を探る
2. **現実とのギャップ分析**: 「今の生活で、その理想に一番近い瞬間はいつ？」で接点を見つける
3. **時間配分の妥当性チェック**: キャパシティバーのデータをもとに「この時間配分で無理はない？」と確認する
4. **具体的アクション提案**: 「明日から始められる小さな一歩は？」で行動に落とす
5. **振り返り促進**: 「先週試してみてどうだった？」で進捗を確認する
${layer4Block}
${layer2Block}
${idealBlock}

${contextUpdateSection}

${optionsSection}`
}

/**
 * ideal_goals + ideal_items データを LLM 用テキストにフォーマットする
 */
export function formatIdealGoalsForPrompt(
  ideals: Array<{
    id: string
    title: string
    monthly_cost: number | null
    items: Array<{
      title: string
      daily_minutes: number
      is_done: boolean
    }>
  }>,
  dailyCapacityMinutes: number,
): string {
  if (ideals.length === 0) return ''

  const totalDailyMinutes = ideals.reduce(
    (sum, g) => sum + g.items.reduce((s, i) => s + (i.is_done ? 0 : i.daily_minutes), 0),
    0,
  )

  const lines = ideals.map((g, idx) => {
    const itemLines = g.items.map(i => {
      const status = i.is_done ? '[完了]' : '[未完了]'
      return `    - ${status} ${i.title}（${i.daily_minutes}分/日）`
    })
    const cost = g.monthly_cost ? `月額: ¥${g.monthly_cost.toLocaleString()}` : '月額: 未設定'
    return `${idx + 1}. **${g.title}**（${cost}）\n${itemLines.join('\n')}`
  })

  return `${lines.join('\n\n')}

---
1日のキャパシティ: ${dailyCapacityMinutes}分
現在の合計負荷: ${totalDailyMinutes}分/日（残り: ${dailyCapacityMinutes - totalDailyMinutes}分）`
}
