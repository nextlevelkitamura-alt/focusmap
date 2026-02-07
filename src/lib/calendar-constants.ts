/** Calendar shared constants */

/** Height in pixels for one hour slot in day/week views */
export const HOUR_HEIGHT = 64

/** Total height for 24 hours (HOUR_HEIGHT * 24) */
export const DAY_TOTAL_HEIGHT = HOUR_HEIGHT * 24

/** Default scroll position (9:00 AM) */
export const DEFAULT_SCROLL_HOUR = 9

/** Array of 24 hours [0..23] */
export const HOURS = Array.from({ length: 24 }, (_, i) => i)

/** Minimum grid width to prevent crushing */
export const MIN_GRID_WIDTH_WEEK = 600
export const MIN_GRID_WIDTH_DAY = 300
