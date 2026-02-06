import { CalendarEvent } from "@/types/calendar";

export interface EventPosition {
    top: number; // Percentage from top (0-100)
    height: number; // Percentage height
    left: number; // Percentage from left (0-100)
    width: number; // Percentage width
}

/**
 * Calculates the layout for overlapping events in a day view.
 * Returns a map of event ID to position styles (top, height, left, width).
 */
export function calculateEventLayout(events: CalendarEvent[]): Record<string, EventPosition> {
    if (events.length === 0) return {};

    // 1. Sort events by start time, then duration (descending)
    const sortedEvents = [...events].sort((a, b) => {
        const startDiff = new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
        if (startDiff !== 0) return startDiff;
        const durationA = new Date(a.end_time).getTime() - new Date(a.start_time).getTime();
        const durationB = new Date(b.end_time).getTime() - new Date(b.start_time).getTime();
        return durationB - durationA;
    });

    const positions: Record<string, EventPosition> = {};

    // Refined approach: We need to group connected events (clusters) to determine width
    // Group colliding events together.

    const clusters: CalendarEvent[][] = [];
    let currentCluster: CalendarEvent[] = [];

    // Re-sort for clustering just by start time for safety
    const timeSortedEvents = [...events].sort((a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

    if (timeSortedEvents.length > 0) {
        currentCluster.push(timeSortedEvents[0]);
        let clusterEnd = new Date(timeSortedEvents[0].end_time).getTime();

        for (let i = 1; i < timeSortedEvents.length; i++) {
            const event = timeSortedEvents[i];
            const start = new Date(event.start_time).getTime();
            const end = new Date(event.end_time).getTime();

            if (start < clusterEnd) {
                currentCluster.push(event);
                clusterEnd = Math.max(clusterEnd, end);
            } else {
                clusters.push(currentCluster);
                currentCluster = [event];
                clusterEnd = end;
            }
        }
        clusters.push(currentCluster);
    }

    // Process each cluster independently
    for (const cluster of clusters) {
        // Pack cluster into columns
        const clusterColumns: CalendarEvent[][] = [];
        for (const event of cluster) {
            let placed = false;
            for (let i = 0; i < clusterColumns.length; i++) {
                if (!collidesWithAny(event, clusterColumns[i])) {
                    clusterColumns[i].push(event);
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                clusterColumns.push([event]);
            }
        }

        // Assign Layout
        const totalColumns = clusterColumns.length;
        const width = 100 / totalColumns;

        for (let i = 0; i < totalColumns; i++) {
            for (const event of clusterColumns[i]) {
                const start = new Date(event.start_time);
                const end = new Date(event.end_time);
                const startHour = start.getHours() + start.getMinutes() / 60;
                const endHour = end.getHours() + end.getMinutes() / 60;

                const top = (startHour / 24) * 100;
                const duration = endHour - startHour;
                const height = Math.max((duration / 24) * 100, 1.5); // Min height ~20 min visually

                positions[event.id] = {
                    top,
                    height,
                    left: i * width,
                    width: width // Simple equal width
                };
            }
        }
    }

    return positions;
}

function collidesWithAny(event: CalendarEvent, existingParams: CalendarEvent[]): boolean {
    const start = new Date(event.start_time).getTime();
    const end = new Date(event.end_time).getTime();

    return existingParams.some(other => {
        const otherStart = new Date(other.start_time).getTime();
        const otherEnd = new Date(other.end_time).getTime();
        return start < otherEnd && end > otherStart;
    });
}
