export const AGENT_PREF_ASK_CALENDAR_ON_EVENT_CREATE = "calendar_ask_on_event_create" as const

export interface AgentCalendarPreferences {
  askCalendarOnEventCreate: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function parseAgentCalendarPreferences(preferences: unknown): AgentCalendarPreferences {
  const record = asRecord(preferences)
  const calendar = asRecord(record.calendar)
  const value =
    record[AGENT_PREF_ASK_CALENDAR_ON_EVENT_CREATE] ??
    record.ask_calendar_on_event_create ??
    calendar.ask_calendar_on_event_create

  return {
    askCalendarOnEventCreate: value === true,
  }
}

export function buildCalendarPreferenceInstructions(preferences: AgentCalendarPreferences): string {
  if (!preferences.askCalendarOnEventCreate) {
    return "- AI設定「予定作成時に毎回カレンダーを聞く」はOFFです。ユーザーがカレンダーを指定しない予定作成は、既存のデフォルトカレンダー設定を使ってよい。"
  }

  return [
    "- AI設定「予定作成時に毎回カレンダーを聞く」はONです。",
    "- 新しい予定を作成する前に、必ず listCalendarEvents で available_calendars を確認し、「どのカレンダーに入れますか？」と候補名つきでユーザーへ聞く。",
    "- デフォルトカレンダーや直近のカレンダーをAI判断で選ばない。ユーザーが今回の予定についてカレンダーを選んだ後だけ addCalendarEvent に calendarId を渡す。",
  ].join("\n")
}
