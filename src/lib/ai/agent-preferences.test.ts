import { describe, expect, test } from "vitest"
import {
  AGENT_PREF_ASK_CALENDAR_ON_EVENT_CREATE,
  buildCalendarPreferenceInstructions,
  parseAgentCalendarPreferences,
} from "@/lib/ai/agent-preferences"

describe("agent calendar preferences", () => {
  test("parses the current flat preference key", () => {
    expect(parseAgentCalendarPreferences({
      [AGENT_PREF_ASK_CALENDAR_ON_EVENT_CREATE]: true,
    })).toEqual({ askCalendarOnEventCreate: true })
  })

  test("keeps older nested preference values readable", () => {
    expect(parseAgentCalendarPreferences({
      calendar: { ask_calendar_on_event_create: true },
    })).toEqual({ askCalendarOnEventCreate: true })
  })

  test("defaults to using the existing calendar default flow", () => {
    const preferences = parseAgentCalendarPreferences(null)

    expect(preferences.askCalendarOnEventCreate).toBe(false)
    expect(buildCalendarPreferenceInstructions(preferences)).toContain("OFF")
  })

  test("instructs the agent not to pick a calendar when the toggle is on", () => {
    const instructions = buildCalendarPreferenceInstructions({ askCalendarOnEventCreate: true })

    expect(instructions).toContain("ON")
    expect(instructions).toContain("どのカレンダーに入れますか")
    expect(instructions).toContain("AI判断で選ばない")
  })
})
