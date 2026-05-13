export type Stage = {
  id: string;
  file: string;
  description: string;
};

/**
 * 各ステージのMP4は ../raw/ 配下に置く前提。
 * 不足ファイルがあった場合は OAuthDemo 側で黒画面 + ステージ名 表示にフォールバックする。
 */
export const STAGES: Stage[] = [
  { id: "A", file: "stage-A-opening.mp4", description: "Opening / homepage" },
  { id: "B", file: "stage-B-privacy.mp4", description: "Privacy policy" },
  { id: "C", file: "stage-C-signin.mp4", description: "Google sign-in" },
  { id: "D", file: "stage-D-consent.mp4", description: "OAuth consent screen" },
  { id: "E", file: "stage-E-calendarlist.mp4", description: "calendar.calendarlist.readonly usage" },
  { id: "F", file: "stage-F-events-read.mp4", description: "calendar.events read" },
  { id: "G", file: "stage-G-events-write.mp4", description: "calendar.events write (CREATE/UPDATE/DELETE)" },
  { id: "H", file: "stage-H-revoke.mp4", description: "Revoke / disconnect" },
  { id: "I", file: "stage-I-closing.mp4", description: "Closing" },
];
