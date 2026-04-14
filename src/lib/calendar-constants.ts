/** Calendar shared constants */

/** Height in pixels for one hour slot in day/week views */
export const HOUR_HEIGHT = 64

/** Total height for 24 hours (HOUR_HEIGHT * 24) */
export const DAY_TOTAL_HEIGHT = HOUR_HEIGHT * 24

/** Default scroll position (9:00 AM) */
export const DEFAULT_SCROLL_HOUR = 9

/** Array of 24 hours [0..23] */
export const HOURS = Array.from({ length: 24 }, (_, i) => i)

/** 15分間隔の分単位配列 [0, 15, 30, 45] */
export const QUARTER_HOURS = [0, 15, 30, 45]

/** Minimum grid width to prevent crushing */
export const MIN_GRID_WIDTH_WEEK = 600
export const MIN_GRID_WIDTH_DAY = 300

/** Width in pixels for the gutter area on the right side of the calendar grid.
 *  Provides a drop zone for adding events even when existing events overlap. */
export const GUTTER_WIDTH = 40

/** Dynamic font sizes based on event duration (in minutes) */
export const EVENT_FONT_SIZES = {
  VERY_SHORT: { duration: 30, timeSize: 10, titleSize: 11 },   // < 30分
  SHORT: { duration: 60, timeSize: 11, titleSize: 12 },        // 30-60分
  MEDIUM: { duration: 120, timeSize: 11, titleSize: 13 },      // 60-120分
  NORMAL: { duration: Infinity, timeSize: 12, titleSize: 14 }  // 120分以上
} as const

/** Zoom configuration */
export const ZOOM_CONFIG = {
  MIN_HOUR_HEIGHT: 32,     // 最小（50%ズームアウト）
  DEFAULT_HOUR_HEIGHT: 64, // デフォルト（100%）
  MAX_HOUR_HEIGHT: 128,    // 最大（200%ズームイン）
  WHEEL_ZOOM_DELTA: 8,     // ホイール1回の変化量
  PINCH_ZOOM_SENSITIVITY: 0.5 // ピンチ感度
} as const
