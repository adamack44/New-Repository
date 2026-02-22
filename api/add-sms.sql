-- ============================================================
-- Run this in your Supabase SQL Editor
-- Adds SMS reminder tracking columns to appointments table
-- ============================================================

alter table appointments
  add column if not exists customer_phone text,
  add column if not exists reminder_sent boolean default false;
