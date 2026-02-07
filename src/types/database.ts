export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            goals: {
                Row: {
                    id: string
                    user_id: string
                    title: string
                    description: string | null
                    status: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    title: string
                    description?: string | null
                    status?: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    title?: string
                    description?: string | null
                    status?: string
                    created_at?: string
                }
            }
            projects: {
                Row: {
                    id: string
                    user_id: string
                    goal_id: string
                    title: string
                    purpose: string | null
                    category_tag: string | null
                    priority: number
                    status: string
                    color_theme: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    goal_id: string
                    title: string
                    purpose?: string | null
                    category_tag?: string | null
                    priority?: number
                    status?: string
                    color_theme?: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    goal_id?: string
                    title?: string
                    purpose?: string | null
                    category_tag?: string | null
                    priority?: number
                    status?: string
                    color_theme?: string
                    created_at?: string
                }
            }
            task_groups: {
                Row: {
                    id: string
                    user_id: string
                    project_id: string
                    title: string
                    order_index: number
                    priority: number | null
                    scheduled_at: string | null
                    estimated_time: number | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    project_id: string
                    title: string
                    order_index?: number
                    priority?: number | null
                    scheduled_at?: string | null
                    estimated_time?: number | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    project_id?: string
                    title?: string
                    order_index?: number
                    priority?: number | null
                    scheduled_at?: string | null
                    estimated_time?: number | null
                    created_at?: string
                }
            }
            tasks: {
                Row: {
                    id: string
                    user_id: string
                    group_id: string
                    parent_task_id: string | null
                    title: string
                    status: string
                    priority: number | null
                    order_index: number
                    scheduled_at: string | null
                    estimated_time: number
                    actual_time_minutes: number
                    google_event_id: string | null
                    calendar_event_id: string | null
                    calendar_id: string | null // Added for calendar selection
                    // Timer columns
                    total_elapsed_seconds: number
                    last_started_at: string | null
                    is_timer_running: boolean
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    group_id: string
                    parent_task_id?: string | null
                    title: string
                    status?: string
                    priority?: number | null
                    order_index?: number
                    scheduled_at?: string | null
                    estimated_time?: number
                    actual_time_minutes?: number
                    google_event_id?: string | null
                    calendar_event_id?: string | null
                    calendar_id?: string | null
                    // Timer columns
                    total_elapsed_seconds?: number
                    last_started_at?: string | null
                    is_timer_running?: boolean
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    group_id?: string
                    parent_task_id?: string | null
                    title?: string
                    status?: string
                    priority?: number | null
                    order_index?: number
                    scheduled_at?: string | null
                    estimated_time?: number
                    actual_time_minutes?: number
                    google_event_id?: string | null
                    calendar_event_id?: string | null
                    calendar_id?: string | null
                    // Timer columns
                    total_elapsed_seconds?: number
                    last_started_at?: string | null
                    is_timer_running?: boolean
                    created_at?: string
                }
            }
            ai_suggestions: {
                Row: {
                    id: string
                    user_id: string
                    suggestion_type: string  // 'task_creation', 'task_reschedule', 'calendar_sync'
                    target_task_id: string | null
                    target_group_id: string | null
                    payload: Json  // Flexible data for different suggestion types
                    status: string  // 'pending', 'accepted', 'rejected', 'adjusted'
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    suggestion_type: string
                    target_task_id?: string | null
                    target_group_id?: string | null
                    payload: Json
                    status?: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    suggestion_type?: string
                    target_task_id?: string | null
                    target_group_id?: string | null
                    payload?: Json
                    status?: string
                    created_at?: string
                }
            }
            calendar_events: {
                Row: {
                    id: string
                    user_id: string
                    google_event_id: string
                    calendar_id: string
                    title: string
                    description: string | null
                    location: string | null
                    start_time: string
                    end_time: string
                    is_all_day: boolean
                    timezone: string
                    recurrence: string[] | null
                    recurring_event_id: string | null
                    color: string | null
                    background_color: string | null
                    google_created_at: string | null
                    google_updated_at: string | null
                    synced_at: string
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    google_event_id: string
                    calendar_id: string
                    title: string
                    description?: string | null
                    location?: string | null
                    start_time: string
                    end_time: string
                    is_all_day?: boolean
                    timezone?: string
                    recurrence?: string[] | null
                    recurring_event_id?: string | null
                    color?: string | null
                    background_color?: string | null
                    google_created_at?: string | null
                    google_updated_at?: string | null
                    synced_at?: string
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    google_event_id?: string
                    calendar_id?: string
                    title?: string
                    description?: string | null
                    location?: string | null
                    start_time?: string
                    end_time?: string
                    is_all_day?: boolean
                    timezone?: string
                    recurrence?: string[] | null
                    recurring_event_id?: string | null
                    color?: string | null
                    background_color?: string | null
                    google_created_at?: string | null
                    google_updated_at?: string | null
                    synced_at?: string
                    created_at?: string
                    updated_at?: string
                }
            }
            notification_settings: {
                Row: {
                    id: string
                    user_id: string
                    notification_type: string
                    is_enabled: boolean
                    advance_minutes: number
                    sound_enabled: boolean
                    email_enabled: boolean
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    notification_type: string
                    is_enabled?: boolean
                    advance_minutes?: number
                    sound_enabled?: boolean
                    email_enabled?: boolean
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    notification_type?: string
                    is_enabled?: boolean
                    advance_minutes?: number
                    sound_enabled?: boolean
                    email_enabled?: boolean
                    created_at?: string
                    updated_at?: string
                }
            }
            notification_queue: {
                Row: {
                    id: string
                    user_id: string
                    target_type: string
                    target_id: string
                    notification_type: string
                    title: string
                    body: string
                    icon_url: string | null
                    action_url: string | null
                    scheduled_at: string
                    sent_at: string | null
                    is_sent: boolean
                    retry_count: number
                    last_error: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    target_type: string
                    target_id: string
                    notification_type: string
                    title: string
                    body: string
                    icon_url?: string | null
                    action_url?: string | null
                    scheduled_at: string
                    sent_at?: string | null
                    is_sent?: boolean
                    retry_count?: number
                    last_error?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    target_type?: string
                    target_id?: string
                    notification_type?: string
                    title?: string
                    body?: string
                    icon_url?: string | null
                    action_url?: string | null
                    scheduled_at?: string
                    sent_at?: string | null
                    is_sent?: boolean
                    retry_count?: number
                    last_error?: string | null
                    created_at?: string
                }
            }
            user_calendars: {
                Row: {
                    id: string
                    user_id: string
                    google_calendar_id: string
                    name: string
                    description: string | null
                    location: string | null
                    timezone: string
                    color: string | null
                    background_color: string | null
                    selected: boolean
                    access_level: string | null
                    is_primary: boolean
                    google_created_at: string | null
                    google_updated_at: string | null
                    synced_at: string
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    google_calendar_id: string
                    name: string
                    description?: string | null
                    location?: string | null
                    timezone?: string
                    color?: string | null
                    background_color?: string | null
                    selected?: boolean
                    access_level?: string | null
                    primary?: boolean
                    google_created_at?: string | null
                    google_updated_at?: string | null
                    synced_at?: string
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    google_calendar_id?: string
                    name?: string
                    description?: string | null
                    location?: string | null
                    timezone?: string
                    color?: string | null
                    background_color?: string | null
                    selected?: boolean
                    access_level?: string | null
                    primary?: boolean
                    google_created_at?: string | null
                    google_updated_at?: string | null
                    synced_at?: string
                    updated_at?: string
                }
            }
        }
    }
}

// Convenience type aliases for commonly used table rows
export type Task = Database['public']['Tables']['tasks']['Row']
export type TaskInsert = Database['public']['Tables']['tasks']['Insert']
export type TaskUpdate = Database['public']['Tables']['tasks']['Update']

export type TaskGroup = Database['public']['Tables']['task_groups']['Row']
export type TaskGroupInsert = Database['public']['Tables']['task_groups']['Insert']
export type TaskGroupUpdate = Database['public']['Tables']['task_groups']['Update']

export type Project = Database['public']['Tables']['projects']['Row']
export type ProjectInsert = Database['public']['Tables']['projects']['Insert']
export type ProjectUpdate = Database['public']['Tables']['projects']['Update']
