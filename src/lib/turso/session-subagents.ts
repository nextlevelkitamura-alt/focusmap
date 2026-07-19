import { getPersonalOsBoardClient } from './client'

type Row = Record<string, unknown>

// 子08: セッション配下のサブエージェント個体（session_board の session_subagents 由来）。
// hook が board.py sub-start/sub-end で積んだ行を読み取り専用で表示する。
// ラベルは AI が board.py sub-label で書いた値（NULL=未設定→UIは「(無題のサブ作業)」表示）。
// 「稼働中N体」は status='running' の集計でSQL導出する（主観値・第2の状態台帳を持たない）。
// 所要/経過は SQL 導出のみ（done=所要実測・running=経過。主観値を保存しない）。
export type SessionSubagent = {
  sessionKey: string
  subSeq: number
  label: string
  status: 'running' | 'done'
  startedAt: string
  endedAt: string
  elapsedMin: number
}

function asString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function asNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value)
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function toSubagent(row: Row): SessionSubagent {
  const status = asString(row.status)
  return {
    sessionKey: asString(row.session_key),
    subSeq: asNumber(row.sub_seq),
    label: asString(row.label),
    status: status === 'running' ? 'running' : 'done',
    startedAt: asString(row.started_at),
    endedAt: asString(row.ended_at),
    elapsedMin: asNumber(row.elapsed_min),
  }
}

// 所要/経過分は SQL 導出（done=ended_at−started_at・running=JST now−started_at）。
// started_at/ended_at は ISO8601（'T'区切り）で SQLite の JULIANDAY が解釈する。
const sessionSubagentsSql = `
  SELECT
    session_key,
    sub_seq,
    label,
    status,
    started_at,
    ended_at,
    CAST(ROUND(
      MAX(0, (JULIANDAY(COALESCE(ended_at, DATETIME('now', '+9 hours'))) - JULIANDAY(started_at)) * 1440)
    ) AS INTEGER) AS elapsed_min
  FROM session_subagents
  WHERE session_date = COALESCE(:date, DATE('now', '+9 hours'))
  ORDER BY session_key, started_at, sub_seq
`

// 当日のサブエージェント個体を全件取得（時系列。終了サブも当日中は残す＝入れ子に残す設計）。
export async function getSessionSubagents(date?: string): Promise<SessionSubagent[]> {
  const result = await getPersonalOsBoardClient().execute({
    sql: sessionSubagentsSql,
    args: { date: date ?? null },
  })
  return result.rows.map((row) => toSubagent(row as Row))
}

// エージェント行（session_key）ごとにサブ個体をまとめる（AgentRow のタップ展開で入れ子表示に使う）。
export async function getSubagentsBySession(date?: string): Promise<Map<string, SessionSubagent[]>> {
  const all = await getSessionSubagents(date)
  const map = new Map<string, SessionSubagent[]>()
  for (const sub of all) {
    const list = map.get(sub.sessionKey)
    if (list) list.push(sub)
    else map.set(sub.sessionKey, [sub])
  }
  return map
}

// 稼働中体数の SQL 導出（status='running' の集計）。既存の sessions.sub_n と食い違ったら
// イベント由来（この集計）を正とする（設計契約: 導出を正・主観値を持たない）。
export function runningCount(subagents: SessionSubagent[]): number {
  return subagents.reduce((n, s) => (s.status === 'running' ? n + 1 : n), 0)
}
