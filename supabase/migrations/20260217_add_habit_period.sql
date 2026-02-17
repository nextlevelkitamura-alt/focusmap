-- Migration: Add habit period columns to tasks table
-- Created: 2026-02-17
-- Phase 4b of mobile-ui-redesign

-- Add habit period columns
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS habit_start_date DATE,
  ADD COLUMN IF NOT EXISTS habit_end_date DATE;
