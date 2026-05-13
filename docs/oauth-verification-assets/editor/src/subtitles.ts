export type Subtitle = {
  stage: string;
  start: number;
  end: number;
  text: string;
};

export const SUBTITLES: Subtitle[] = [
  { stage: "A1", start: 0, end: 4, text: "Demo for OAuth verification — Focusmap" },
  { stage: "A2", start: 4, end: 9, text: "A task and calendar dashboard that uses Google Calendar." },
  { stage: "A3", start: 9, end: 14, text: "We request two scopes: calendar.events and calendar.calendarlist.readonly." },

  { stage: "B1", start: 14, end: 19, text: "Privacy policy — Section 7 covers Google API Services User Data Policy compliance." },
  { stage: "B2", start: 19, end: 24, text: "Section 8 contains the English Limited Use disclosure." },
  { stage: "B3", start: 24, end: 29, text: "No advertising use. No data sale. No human reads user data without consent." },

  { stage: "C1", start: 29, end: 34, text: "Step 1 — The user signs in with Google." },

  { stage: "D1", start: 34, end: 39, text: "Step 2 — The user clicks Connect Google Calendar inside Focusmap." },
  { stage: "D2", start: 39, end: 44, text: "OAuth consent screen — app name 'Focusmap' is shown." },
  { stage: "D3", start: 44, end: 49, text: "Address bar contains the OAuth client_id." },
  { stage: "D4", start: 49, end: 55, text: "Scopes requested: calendar.events and calendar.calendarlist.readonly." },
  { stage: "D5", start: 55, end: 60, text: "Privacy policy and terms of service links are visible. User clicks Continue." },

  { stage: "E1", start: 60, end: 65, text: "calendar.calendarlist.readonly — fetch the list of the user's calendars." },
  { stage: "E2", start: 65, end: 71, text: "Read-only. User picks which calendars Focusmap should sync." },

  { stage: "F1", start: 71, end: 76, text: "calendar.events (READ) — upcoming events are displayed in Focusmap." },
  { stage: "F2", start: 76, end: 81, text: "Today's schedule appears alongside the user's tasks." },

  { stage: "G1", start: 81, end: 86, text: "calendar.events (WRITE) — user creates a task in Focusmap." },
  { stage: "G2", start: 86, end: 91, text: "Focusmap calls events.insert. The event appears in Google Calendar." },
  { stage: "G3", start: 91, end: 96, text: "User edits the event in Focusmap — events.update reflects on Google Calendar." },
  { stage: "G4", start: 96, end: 102, text: "User deletes the event in Focusmap — events.delete reflects on Google Calendar." },
  { stage: "G5", start: 102, end: 107, text: "All write operations are triggered by an explicit user action." },

  { stage: "H1", start: 107, end: 112, text: "Disconnect — stored OAuth tokens are deleted." },
  { stage: "H2", start: 112, end: 117, text: "Users can also revoke access at myaccount.google.com/permissions." },

  { stage: "I1", start: 117, end: 122, text: "End-to-end flow and all scopes demonstrated. Thank you for reviewing." },
];

export const TOTAL_DURATION_SECONDS = SUBTITLES.reduce(
  (max, s) => Math.max(max, s.end),
  0,
);
