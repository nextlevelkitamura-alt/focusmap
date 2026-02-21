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
            spaces: {
                Row: {
                    id: string
                    user_id: string
                    title: string
                    description: string | null
                    status: string
                    default_calendar_id: string | null
                    icon: string | null
                    color: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    title: string
                    description?: string | null
                    status?: string
                    default_calendar_id?: string | null
                    icon?: string | null
                    color?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    title?: string
                    description?: string | null
                    status?: string
                    default_calendar_id?: string | null
                    icon?: string | null
                    color?: string | null
                    created_at?: string
                }
            }
            projects: {
                Row: {
                    id: string
                    user_id: string
                    space_id: string
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
                    space_id: string
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
                    space_id?: string
                    title?: string
                    purpose?: string | null
                    category_tag?: string | null
                    priority?: number
                    status?: string
                    color_theme?: string
                    created_at?: string
                }
            }
            tasks: {
                Row: {
                    id: string
                    user_id: string
                    project_id: string | null  // For project-level tasks/groups
                    parent_task_id: string | null
                    is_group: boolean  // 🆕 Group flag (true = group, false = task)
                    title: string
                    status: string
                    stage: string  // 'plan' | 'scheduled' | 'executing' | 'done' | 'archived'
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
                    updated_at: string
                    // Event import columns
                    source: string  // 'manual' | 'google_event'
                    deleted_at: string | null
                    google_event_fingerprint: string | null
                    // Habit columns
                    is_habit: boolean
                    habit_frequency: string | null
                    habit_icon: string | null
                    habit_start_date: string | null
                    habit_end_date: string | null
                    // Memo
                    memo: string | null
                }
                Insert: {
                    id?: string
                    user_id: string
                    project_id?: string | null  // For project-level tasks/groups
                    parent_task_id?: string | null
                    is_group?: boolean  // 🆕 Group flag (default: false)
                    title: string
                    status?: string
                    stage?: string  // default: 'plan'
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
                    updated_at?: string
                    // Event import columns
                    source?: string  // default: 'manual'
                    deleted_at?: string | null
                    google_event_fingerprint?: string | null
                    // Habit columns
                    is_habit?: boolean
                    habit_frequency?: string | null
                    habit_icon?: string | null
                    habit_start_date?: string | null
                    habit_end_date?: string | null
                    // Memo
                    memo?: string | null
                }
                Update: {
                    id?: string
                    user_id?: string
                    project_id?: string | null  // For project-level tasks/groups
                    parent_task_id?: string | null
                    is_group?: boolean  // 🆕 Group flag
                    title?: string
                    status?: string
                    stage?: string
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
                    updated_at?: string
                    // Event import columns
                    source?: string
                    deleted_at?: string | null
                    google_event_fingerprint?: string | null
                    // Habit columns
                    is_habit?: boolean
                    habit_frequency?: string | null
                    habit_icon?: string | null
                    habit_start_date?: string | null
                    habit_end_date?: string | null
                    // Memo
                    memo?: string | null
                }
            }
            habit_completions: {
                Row: {
                    id: string
                    habit_id: string
                    user_id: string
                    completed_date: string
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    habit_id: string
                    user_id: string
                    completed_date: string
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    habit_id?: string
                    user_id?: string
                    completed_date?: string
                    created_at?: string
                    updated_at?: string
                }
            }
            habit_task_completions: {
                Row: {
                    id: string
                    habit_id: string
                    task_id: string
                    user_id: string
                    completed_date: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    habit_id: string
                    task_id: string
                    user_id: string
                    completed_date: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    habit_id?: string
                    task_id?: string
                    user_id?: string
                    completed_date?: string
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

// Task stage type
export type TaskStage = 'plan' | 'scheduled' | 'executing' | 'done' | 'archived'
export type TaskSource = 'manual' | 'google_event'

// Convenience type aliases for commonly used table rows
export type Task = Database['public']['Tables']['tasks']['Row']
export type TaskInsert = Database['public']['Tables']['tasks']['Insert']
export type TaskUpdate = Database['public']['Tables']['tasks']['Update']

export type Project = Database['public']['Tables']['projects']['Row']
export type ProjectInsert = Database['public']['Tables']['projects']['Insert']
export type ProjectUpdate = Database['public']['Tables']['projects']['Update']

export type Space = Database['public']['Tables']['spaces']['Row']
export type SpaceInsert = Database['public']['Tables']['spaces']['Insert']
export type SpaceUpdate = Database['public']['Tables']['spaces']['Update']

export type HabitCompletion = Database['public']['Tables']['habit_completions']['Row']
export type HabitCompletionInsert = Database['public']['Tables']['habit_completions']['Insert']

export type HabitTaskCompletion = Database['public']['Tables']['habit_task_completions']['Row']
export type HabitTaskCompletionInsert = Database['public']['Tables']['habit_task_completions']['Insert']
