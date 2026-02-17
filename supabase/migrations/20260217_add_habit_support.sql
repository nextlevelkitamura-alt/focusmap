-- Migration: Add habit support to tasks table and create habit_completions table
-- Created: 2026-02-17
-- Phase 3 of mobile-ui-redesign

-- ========================================
-- Part 1: Extend tasks table for habits
-- ========================================

-- Add habit-related columns to tasks table
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS is_habit BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS habit_frequency TEXT,
  ADD COLUMN IF NOT EXISTS habit_icon TEXT;

-- Add index for habit tasks (performance optimization)
CREATE INDEX IF NOT EXISTS idx_tasks_is_habit
  ON tasks(user_id, is_habit)
  WHERE is_habit = true;

-- ========================================
-- Part 2: Create habit_completions table
-- ========================================

-- Create table for habit completion tracking
CREATE TABLE IF NOT EXISTS habit_completions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    habit_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    completed_date DATE NOT NULL,
    child_task_ids UUID[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure one record per habit per day
    UNIQUE(habit_id, completed_date)
);

-- ========================================
-- Part 3: RLS Policies
-- ========================================

-- Enable Row Level Security
ALTER TABLE habit_completions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can manage their own habit completions
CREATE POLICY "Users manage own habit completions"
    ON habit_completions
    FOR ALL
    USING (auth.uid() = user_id);

-- ========================================
-- Part 4: Indexes for performance
-- ========================================

-- Index for querying completions by habit and date
CREATE INDEX IF NOT EXISTS idx_habit_completions_date
    ON habit_completions(habit_id, completed_date);

-- Index for querying completions by user and date
CREATE INDEX IF NOT EXISTS idx_habit_completions_user_date
    ON habit_completions(user_id, completed_date);

-- ========================================
-- Migration Complete
-- ========================================
-- Next steps:
-- 1. Execute this SQL in Supabase SQL Editor
-- 2. Update src/types/database.ts with new columns
-- 3. Verify migration success with: SELECT * FROM tasks LIMIT 1;
