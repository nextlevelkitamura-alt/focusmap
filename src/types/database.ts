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
                    memo_images: string[] | null
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
                    memo_images?: string[] | null
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
                    memo_images?: string[] | null
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
                    elapsed_seconds: number
                    created_at: string
                }
                Insert: {
                    id?: string
                    habit_id: string
                    task_id: string
                    user_id: string
                    completed_date: string
                    elapsed_seconds?: number
                    created_at?: string
                }
                Update: {
                    id?: string
                    habit_id?: string
                    task_id?: string
                    user_id?: string
                    completed_date?: string
                    elapsed_seconds?: number
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
                    reminders: number[] | null
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
                    reminders?: number[] | null
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
                    reminders?: number[] | null
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
            ai_user_context: {
                Row: {
                    id: string
                    user_id: string
                    persona: string
                    preferences: Json
                    life_personality: string
                    life_purpose: string
                    current_situation: string
                    updated_at: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    persona?: string
                    preferences?: Json
                    life_personality?: string
                    life_purpose?: string
                    current_situation?: string
                    updated_at?: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    persona?: string
                    preferences?: Json
                    life_personality?: string
                    life_purpose?: string
                    current_situation?: string
                    updated_at?: string
                    created_at?: string
                }
            }
            ai_project_context: {
                Row: {
                    id: string
                    user_id: string
                    project_id: string
                    purpose: string
                    current_status: string
                    key_insights: string
                    updated_at: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    project_id: string
                    purpose?: string
                    current_status?: string
                    key_insights?: string
                    updated_at?: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    project_id?: string
                    purpose?: string
                    current_status?: string
                    key_insights?: string
                    updated_at?: string
                    created_at?: string
                }
            }
            ai_context_folders: {
                Row: {
                    id: string
                    user_id: string
                    parent_id: string | null
                    folder_type: 'root_personal' | 'root_projects' | 'project' | 'custom'
                    project_id: string | null
                    title: string
                    icon: string | null
                    order_index: number
                    is_system: boolean
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    parent_id?: string | null
                    folder_type?: 'root_personal' | 'root_projects' | 'project' | 'custom'
                    project_id?: string | null
                    title: string
                    icon?: string | null
                    order_index?: number
                    is_system?: boolean
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    parent_id?: string | null
                    folder_type?: 'root_personal' | 'root_projects' | 'project' | 'custom'
                    project_id?: string | null
                    title?: string
                    icon?: string | null
                    order_index?: number
                    is_system?: boolean
                    updated_at?: string
                }
            }
            ai_context_documents: {
                Row: {
                    id: string
                    user_id: string
                    folder_id: string
                    title: string
                    content: string
                    document_type: 'personality' | 'purpose' | 'situation' | 'project_purpose' | 'project_status' | 'project_insights' | 'note'
                    max_length: number
                    source: 'manual' | 'ai_interview' | 'ai_auto'
                    order_index: number
                    is_pinned: boolean
                    content_updated_at: string
                    freshness_reviewed_at: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    folder_id: string
                    title: string
                    content?: string
                    document_type?: 'personality' | 'purpose' | 'situation' | 'project_purpose' | 'project_status' | 'project_insights' | 'note'
                    max_length?: number
                    source?: 'manual' | 'ai_interview' | 'ai_auto'
                    order_index?: number
                    is_pinned?: boolean
                    content_updated_at?: string
                    freshness_reviewed_at?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    folder_id?: string
                    title?: string
                    content?: string
                    document_type?: 'personality' | 'purpose' | 'situation' | 'project_purpose' | 'project_status' | 'project_insights' | 'note'
                    max_length?: number
                    source?: 'manual' | 'ai_interview' | 'ai_auto'
                    order_index?: number
                    is_pinned?: boolean
                    content_updated_at?: string
                    freshness_reviewed_at?: string | null
                    updated_at?: string
                }
            }
            api_keys: {
                Row: {
                    id: string
                    user_id: string
                    key_hash: string
                    key_prefix: string
                    name: string
                    scopes: string[]
                    last_used_at: string | null
                    expires_at: string | null
                    is_active: boolean
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    key_hash: string
                    key_prefix: string
                    name?: string
                    scopes?: string[]
                    last_used_at?: string | null
                    expires_at?: string | null
                    is_active?: boolean
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    key_hash?: string
                    key_prefix?: string
                    name?: string
                    scopes?: string[]
                    last_used_at?: string | null
                    expires_at?: string | null
                    is_active?: boolean
                    created_at?: string
                }
            }
            task_attachments: {
                Row: {
                    id: string
                    user_id: string
                    task_id: string
                    file_name: string
                    file_url: string
                    storage_path: string
                    file_type: string
                    file_size: number
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    task_id: string
                    file_name: string
                    file_url: string
                    storage_path: string
                    file_type: string
                    file_size: number
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    task_id?: string
                    file_name?: string
                    file_url?: string
                    storage_path?: string
                    file_type?: string
                    file_size?: number
                    created_at?: string
                }
            }
            ideal_goals: {
                Row: {
                    id: string
                    user_id: string
                    title: string
                    description: string | null
                    cover_image_url: string | null
                    cover_image_path: string | null
                    category: string | null
                    color: string
                    status: string
                    display_order: number
                    duration_months: number | null
                    start_date: string | null
                    target_date: string | null
                    total_daily_minutes: number
                    cost_total: number | null
                    cost_monthly: number | null
                    ai_summary: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    title: string
                    description?: string | null
                    cover_image_url?: string | null
                    cover_image_path?: string | null
                    category?: string | null
                    color?: string
                    status?: string
                    display_order?: number
                    duration_months?: number | null
                    start_date?: string | null
                    target_date?: string | null
                    total_daily_minutes?: number
                    cost_total?: number | null
                    cost_monthly?: number | null
                    ai_summary?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    title?: string
                    description?: string | null
                    cover_image_url?: string | null
                    cover_image_path?: string | null
                    category?: string | null
                    color?: string
                    status?: string
                    display_order?: number
                    duration_months?: number | null
                    start_date?: string | null
                    target_date?: string | null
                    total_daily_minutes?: number
                    cost_total?: number | null
                    cost_monthly?: number | null
                    ai_summary?: string | null
                    updated_at?: string
                }
            }
            ideal_items: {
                Row: {
                    id: string
                    ideal_id: string
                    user_id: string
                    title: string
                    item_type: string
                    frequency_type: string
                    frequency_value: number
                    session_minutes: number
                    daily_minutes: number
                    item_cost: number | null
                    cost_type: string | null
                    is_done: boolean
                    linked_task_id: string | null
                    linked_habit_id: string | null
                    display_order: number
                    description: string | null
                    scheduled_date: string | null
                    reference_url: string | null
                    thumbnail_url: string | null
                    thumbnail_path: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    ideal_id: string
                    user_id: string
                    title: string
                    item_type?: string
                    frequency_type?: string
                    frequency_value?: number
                    session_minutes?: number
                    daily_minutes?: number
                    item_cost?: number | null
                    cost_type?: string | null
                    is_done?: boolean
                    linked_task_id?: string | null
                    linked_habit_id?: string | null
                    display_order?: number
                    description?: string | null
                    scheduled_date?: string | null
                    reference_url?: string | null
                    thumbnail_url?: string | null
                    thumbnail_path?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    ideal_id?: string
                    user_id?: string
                    title?: string
                    item_type?: string
                    frequency_type?: string
                    frequency_value?: number
                    session_minutes?: number
                    daily_minutes?: number
                    item_cost?: number | null
                    cost_type?: string | null
                    is_done?: boolean
                    linked_task_id?: string | null
                    linked_habit_id?: string | null
                    display_order?: number
                    description?: string | null
                    scheduled_date?: string | null
                    reference_url?: string | null
                    thumbnail_url?: string | null
                    thumbnail_path?: string | null
                    updated_at?: string
                }
            }
            ideal_attachments: {
                Row: {
                    id: string
                    user_id: string
                    ideal_id: string
                    file_name: string
                    file_url: string
                    storage_path: string
                    file_type: string
                    file_size: number
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    ideal_id: string
                    file_name: string
                    file_url: string
                    storage_path: string
                    file_type: string
                    file_size: number
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    ideal_id?: string
                    file_name?: string
                    file_url?: string
                    storage_path?: string
                    file_type?: string
                    file_size?: number
                    created_at?: string
                }
            }
            ideal_item_images: {
                Row: {
                    id: string
                    item_id: string
                    user_id: string
                    image_url: string
                    storage_path: string
                    caption: string | null
                    display_order: number
                    created_at: string
                }
                Insert: {
                    id?: string
                    item_id: string
                    user_id: string
                    image_url: string
                    storage_path: string
                    caption?: string | null
                    display_order?: number
                    created_at?: string
                }
                Update: {
                    id?: string
                    item_id?: string
                    user_id?: string
                    image_url?: string
                    storage_path?: string
                    caption?: string | null
                    display_order?: number
                    created_at?: string
                }
            }
            ideal_candidates: {
                Row: {
                    id: string
                    item_id: string
                    user_id: string
                    title: string
                    url: string | null
                    image_url: string | null
                    image_path: string | null
                    price: number | null
                    pros: string | null
                    cons: string | null
                    rating: number | null
                    status: string
                    display_order: number
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    item_id: string
                    user_id: string
                    title: string
                    url?: string | null
                    image_url?: string | null
                    image_path?: string | null
                    price?: number | null
                    pros?: string | null
                    cons?: string | null
                    rating?: number | null
                    status?: string
                    display_order?: number
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    item_id?: string
                    user_id?: string
                    title?: string
                    url?: string | null
                    image_url?: string | null
                    image_path?: string | null
                    price?: number | null
                    pros?: string | null
                    cons?: string | null
                    rating?: number | null
                    status?: string
                    display_order?: number
                    updated_at?: string
                }
            }
            ideal_item_completions: {
                Row: {
                    id: string
                    ideal_item_id: string
                    user_id: string
                    completed_date: string
                    is_completed: boolean
                    elapsed_minutes: number
                    note: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    ideal_item_id: string
                    user_id: string
                    completed_date: string
                    is_completed?: boolean
                    elapsed_minutes?: number
                    note?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    ideal_item_id?: string
                    user_id?: string
                    completed_date?: string
                    is_completed?: boolean
                    elapsed_minutes?: number
                    note?: string | null
                    updated_at?: string
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

export type AiUserContext = Database['public']['Tables']['ai_user_context']['Row']
export type AiUserContextUpdate = Database['public']['Tables']['ai_user_context']['Update']

export type AiProjectContext = Database['public']['Tables']['ai_project_context']['Row']
export type AiProjectContextInsert = Database['public']['Tables']['ai_project_context']['Insert']
export type AiProjectContextUpdate = Database['public']['Tables']['ai_project_context']['Update']

export type AiContextFolder = Database['public']['Tables']['ai_context_folders']['Row']
export type AiContextFolderInsert = Database['public']['Tables']['ai_context_folders']['Insert']
export type AiContextFolderUpdate = Database['public']['Tables']['ai_context_folders']['Update']

export type AiContextDocument = Database['public']['Tables']['ai_context_documents']['Row']
export type AiContextDocumentInsert = Database['public']['Tables']['ai_context_documents']['Insert']
export type AiContextDocumentUpdate = Database['public']['Tables']['ai_context_documents']['Update']

export type TaskAttachment = Database['public']['Tables']['task_attachments']['Row']
export type TaskAttachmentInsert = Database['public']['Tables']['task_attachments']['Insert']

export type IdealGoal = Database['public']['Tables']['ideal_goals']['Row']
export type IdealGoalInsert = Database['public']['Tables']['ideal_goals']['Insert']
export type IdealGoalUpdate = Database['public']['Tables']['ideal_goals']['Update']

export type IdealItem = Database['public']['Tables']['ideal_items']['Row']
export type IdealItemInsert = Database['public']['Tables']['ideal_items']['Insert']
export type IdealItemUpdate = Database['public']['Tables']['ideal_items']['Update']

export type IdealAttachment = Database['public']['Tables']['ideal_attachments']['Row']
export type IdealAttachmentInsert = Database['public']['Tables']['ideal_attachments']['Insert']

export type IdealItemImage = Database['public']['Tables']['ideal_item_images']['Row']
export type IdealItemImageInsert = Database['public']['Tables']['ideal_item_images']['Insert']

export type IdealCandidate = Database['public']['Tables']['ideal_candidates']['Row']
export type IdealCandidateInsert = Database['public']['Tables']['ideal_candidates']['Insert']
export type IdealCandidateUpdate = Database['public']['Tables']['ideal_candidates']['Update']

export type IdealItemCompletion = Database['public']['Tables']['ideal_item_completions']['Row']
export type IdealItemCompletionInsert = Database['public']['Tables']['ideal_item_completions']['Insert']

export type CandidateStatus = 'considering' | 'selected' | 'rejected'

// ideal_items の item_type
export type IdealItemType = 'habit' | 'action' | 'cost' | 'milestone'
// ideal_items / ideal_goals の frequency_type
export type FrequencyType = 'daily' | 'weekly' | 'monthly' | 'once'
// ideal_goals の status
export type IdealGoalStatus = 'active' | 'achieved' | 'archived'

// IdealGoal に ideal_items を JOIN した拡張型
export type IdealGoalWithItems = IdealGoal & { ideal_items: IdealItem[] }

// IdealItem に images と candidates を JOIN した拡張型
export type IdealItemWithDetails = IdealItem & {
    ideal_item_images: IdealItemImage[]
    ideal_candidates: IdealCandidate[]
}

// IdealGoal に詳細なアイテムを JOIN した拡張型
export type IdealGoalFull = IdealGoal & { ideal_items: IdealItemWithDetails[] }

export type CostType = 'once' | 'monthly' | 'annual'

/** daily_minutes の正規化計算 */
export function calcDailyMinutes(
    frequencyType: FrequencyType,
    frequencyValue: number,
    sessionMinutes: number
): number {
    switch (frequencyType) {
        case 'daily':   return sessionMinutes
        case 'weekly':  return Math.round(sessionMinutes * frequencyValue / 7)
        case 'monthly': return Math.round(sessionMinutes * frequencyValue / 30)
        default:        return 0
    }
}

/** コストの月額換算（円） */
export function calcMonthlyCost(
    costType: CostType,
    itemCost: number,
    durationMonths: number | null
): number {
    switch (costType) {
        case 'monthly': return itemCost
        case 'annual':  return Math.round(itemCost / 12)
        case 'once':    return Math.round(itemCost / (durationMonths ?? 12))
    }
}

/** コストの年額換算（円） */
export function calcAnnualCost(
    costType: CostType,
    itemCost: number,
): number {
    switch (costType) {
        case 'monthly': return itemCost * 12
        case 'annual':  return itemCost
        case 'once':    return itemCost
    }
}
