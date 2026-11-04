-- Adds the phone column to the existing newsletter_subscribers table.
-- Safe to run multiple times.
-- Paste ONLY this SQL file into the Supabase SQL editor (not .ts files).

alter table public.newsletter_subscribers
  add column if not exists phone text;
