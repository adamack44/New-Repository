-- ============================================================
-- Run this in your Supabase SQL Editor
-- Adds subscription tracking columns to the stylists table
-- ============================================================

alter table stylists
  add column if not exists subscription_status text default 'inactive',
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;
