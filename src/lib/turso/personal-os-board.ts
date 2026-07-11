import { getPersonalOsBoardClient, getPersonalOsInboxClient } from './client'

type Row = Record<string, unknown>

export type DailyTotals = {
  sessionDate: string
  runMin: number
  waitMin: number
  subMin: number
  sessions: number
}

export type GoalRollup = {
  goal: string
  runMin: number
  waitMin: number
  subMin: number
}

export type SessionBreakdown = {
  sessionKey: string
  goal: string
  sessionDate: string
  runMin: number
  waitMin: number
  subMin: number
}

export type StuckWait = {
  sessionKey: string
  goal: string
  repo: string
  waitingSince: string
  waitMin: number
}

export type CurrentSession = {
  sessionKey: string
  goal: string
  now: string
  type: string
  repo: string
  model: string
  plan: string
  state: string
  updatedAt: string
  subN: number
}

export type FinishedLog = {
  repo: string
  parent: string
  entry: string
  sessionDate: string
  createdAt: string
}

export type DeclaredGoal = {
  id: string
  name: string
  goalDate: string
  createdAt: string
  source: string
  status: string
}

function asString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function asNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value)
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

const dailyTotalsSql = `
  SELECT
    session_date,
    CAST(ROUND(SUM(CASE WHEN state = 'run'  THEN mins ELSE 0 END)) AS INTEGER) AS run_min,
    CAST(ROUND(SUM(CASE WHEN state = 'wait' THEN mins ELSE 0 END)) AS INTEGER) AS wait_min,
    CAST(ROUND(SUM(CASE WHEN state = 'sub'  THEN mins ELSE 0 END)) AS INTEGER) AS sub_min,
    COUNT(DISTINCT session_key) AS sessions
  FROM (
    SELECT
      session_key, session_date, state,
      MAX(0, MIN(720,
        (JULIANDAY(COALESCE(
           LEAD(at) OVER (PARTITION BY session_key ORDER BY at, id),
           DATETIME('now', '+9 hours'))) - JULIANDAY(at)) * 1440
      )) AS mins
    FROM session_events
    WHERE session_date = COALESCE(:date, DATE('now', '+9 hours'))
  )
  WHERE state IN ('run', 'wait', 'sub')
  GROUP BY session_date
`

const goalRollupSql = `
  WITH latest_goals AS (
    SELECT DISTINCT
      session_key,
      LAST_VALUE(goal) OVER (
        PARTITION BY session_key ORDER BY at, id
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
      ) AS goal
    FROM session_events
  ), intervals AS (
    SELECT
      session_key, state,
      MAX(0, MIN(720,
        (JULIANDAY(COALESCE(
           LEAD(at) OVER (PARTITION BY session_key ORDER BY at, id),
           DATETIME('now', '+9 hours'))) - JULIANDAY(at)) * 1440
      )) AS mins
    FROM session_events
    WHERE session_date = COALESCE(:date, DATE('now', '+9 hours'))
  )
  SELECT
    latest_goals.goal AS goal,
    CAST(ROUND(SUM(CASE WHEN intervals.state = 'run'  THEN intervals.mins ELSE 0 END)) AS INTEGER) AS run_min,
    CAST(ROUND(SUM(CASE WHEN intervals.state = 'wait' THEN intervals.mins ELSE 0 END)) AS INTEGER) AS wait_min,
    CAST(ROUND(SUM(CASE WHEN intervals.state = 'sub'  THEN intervals.mins ELSE 0 END)) AS INTEGER) AS sub_min
  FROM intervals
  JOIN latest_goals USING (session_key)
  WHERE intervals.state IN ('run', 'wait', 'sub')
  GROUP BY latest_goals.goal
  ORDER BY latest_goals.goal
`

const sessionBreakdownSql = `
  WITH latest_goals AS (
    SELECT DISTINCT
      session_key,
      LAST_VALUE(goal) OVER (
        PARTITION BY session_key ORDER BY at, id
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
      ) AS goal
    FROM session_events
  ), intervals AS (
    SELECT
      session_key, session_date, state,
      MAX(0, MIN(720,
        (JULIANDAY(COALESCE(
           LEAD(at) OVER (PARTITION BY session_key ORDER BY at, id),
           DATETIME('now', '+9 hours'))) - JULIANDAY(at)) * 1440
      )) AS mins
    FROM session_events
    WHERE session_date = COALESCE(:date, session_date)
  )
  SELECT
    intervals.session_key,
    MAX(latest_goals.goal) AS goal,
    MIN(intervals.session_date) AS session_date,
    CAST(ROUND(SUM(CASE WHEN intervals.state = 'run'  THEN intervals.mins ELSE 0 END)) AS INTEGER) AS run_min,
    CAST(ROUND(SUM(CASE WHEN intervals.state = 'wait' THEN intervals.mins ELSE 0 END)) AS INTEGER) AS wait_min,
    CAST(ROUND(SUM(CASE WHEN intervals.state = 'sub'  THEN intervals.mins ELSE 0 END)) AS INTEGER) AS sub_min
  FROM intervals
  JOIN latest_goals USING (session_key)
  WHERE intervals.state IN ('run', 'wait', 'sub')
  GROUP BY intervals.session_key
  ORDER BY session_date, intervals.session_key
`

const stuckWaitSql = `
  SELECT
    session_key,
    goal,
    repo,
    at AS waiting_since,
    CAST(ROUND((JULIANDAY(DATETIME('now', '+9 hours')) - JULIANDAY(at)) * 1440) AS INTEGER) AS wait_min
  FROM (
    SELECT
      session_key, goal, repo, state, at,
      ROW_NUMBER() OVER (PARTITION BY session_key ORDER BY at DESC, id DESC) AS rn
    FROM session_events
  )
  WHERE rn = 1
    AND state = 'wait'
    AND (JULIANDAY(DATETIME('now', '+9 hours')) - JULIANDAY(at)) * 1440 > :thresholdMinutes
  ORDER BY at
`

export async function getDailyTotals(date?: string): Promise<DailyTotals> {
  const result = await getPersonalOsBoardClient().execute({
    sql: dailyTotalsSql,
    args: { date: date ?? null },
  })
  const row = result.rows[0] as Row | undefined

  if (!row) {
    const fallback = await getPersonalOsBoardClient().execute({
      sql: `SELECT COALESCE(:date, DATE('now', '+9 hours')) AS session_date`,
      args: { date: date ?? null },
    })
    return {
      sessionDate: asString(fallback.rows[0]?.session_date),
      runMin: 0,
      waitMin: 0,
      subMin: 0,
      sessions: 0,
    }
  }

  return {
    sessionDate: asString(row.session_date),
    runMin: asNumber(row.run_min),
    waitMin: asNumber(row.wait_min),
    subMin: asNumber(row.sub_min),
    sessions: asNumber(row.sessions),
  }
}

export async function getGoalRollup(date?: string): Promise<GoalRollup[]> {
  const result = await getPersonalOsBoardClient().execute({
    sql: goalRollupSql,
    args: { date: date ?? null },
  })
  return result.rows.map((row) => ({
    goal: asString(row.goal),
    runMin: asNumber(row.run_min),
    waitMin: asNumber(row.wait_min),
    subMin: asNumber(row.sub_min),
  }))
}

export async function getSessionBreakdown(date?: string): Promise<SessionBreakdown[]> {
  const result = await getPersonalOsBoardClient().execute({
    sql: sessionBreakdownSql,
    args: { date: date ?? null },
  })
  return result.rows.map((row) => ({
    sessionKey: asString(row.session_key),
    goal: asString(row.goal),
    sessionDate: asString(row.session_date),
    runMin: asNumber(row.run_min),
    waitMin: asNumber(row.wait_min),
    subMin: asNumber(row.sub_min),
  }))
}

export async function getStuckWait(thresholdMinutes = 15): Promise<StuckWait[]> {
  const result = await getPersonalOsBoardClient().execute({
    sql: stuckWaitSql,
    args: { thresholdMinutes },
  })
  return result.rows.map((row) => ({
    sessionKey: asString(row.session_key),
    goal: asString(row.goal),
    repo: asString(row.repo),
    waitingSince: asString(row.waiting_since),
    waitMin: asNumber(row.wait_min),
  }))
}

export async function getCurrentSessions(): Promise<CurrentSession[]> {
  const result = await getPersonalOsBoardClient().execute(`
    WITH latest_events AS (
      SELECT
        session_key, state,
        ROW_NUMBER() OVER (PARTITION BY session_key ORDER BY at DESC, id DESC) AS rn
      FROM session_events
    )
    SELECT
      sessions.session_key,
      sessions.goal,
      sessions.now,
      sessions.type,
      sessions.repo,
      sessions.model,
      sessions.plan,
      COALESCE(latest_events.state, sessions.state) AS state,
      sessions.updated_at,
      sessions.sub_n
    FROM sessions
    LEFT JOIN latest_events
      ON latest_events.session_key = sessions.session_key
     AND latest_events.rn = 1
    ORDER BY sessions.updated_at DESC, sessions.session_key
  `)
  return result.rows.map((row) => ({
    sessionKey: asString(row.session_key),
    goal: asString(row.goal),
    now: asString(row.now),
    type: asString(row.type),
    repo: asString(row.repo),
    model: asString(row.model),
    plan: asString(row.plan),
    state: asString(row.state),
    updatedAt: asString(row.updated_at),
    subN: asNumber(row.sub_n),
  }))
}

export async function getFinishedLogs(date?: string): Promise<FinishedLog[]> {
  const result = await getPersonalOsBoardClient().execute({
    sql: `
      SELECT repo, parent, entry, session_date, created_at
      FROM session_logs
      WHERE session_date = COALESCE(:date, DATE('now', '+9 hours'))
      ORDER BY created_at
    `,
    args: { date: date ?? null },
  })
  return result.rows.map((row) => ({
    repo: asString(row.repo),
    parent: asString(row.parent),
    entry: asString(row.entry),
    sessionDate: asString(row.session_date),
    createdAt: asString(row.created_at),
  }))
}

export async function getDeclaredGoals(date?: string): Promise<DeclaredGoal[]> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      SELECT id, name, goal_date, created_at, source, status
      FROM goals
      WHERE goal_date = COALESCE(:date, DATE('now', '+9 hours'))
      ORDER BY created_at
    `,
    args: { date: date ?? null },
  })
  return result.rows.map((row) => ({
    id: asString(row.id),
    name: asString(row.name),
    goalDate: asString(row.goal_date),
    createdAt: asString(row.created_at),
    source: asString(row.source),
    status: asString(row.status),
  }))
}
