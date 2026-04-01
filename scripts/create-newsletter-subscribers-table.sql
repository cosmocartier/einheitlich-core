-- Migration: create newsletter_subscribers table
-- Run this in the Supabase SQL editor:
-- https://app.supabase.com/project/stkxepioooqhzdakxzhw/sql
--
-- Multi-storefront aware: every row is scoped to a storefront_id so
-- subscribers from different storefronts are cleanly separated.

create table if not exists public.newsletter_subscribers (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  storefront_id  uuid not null references public.storefronts(id) on delete cascade,
  source         text not null default 'early_access',  -- which form/channel collected this
  status         text not null default 'active',        -- active | unsubscribed
  created_at     timestamp with time zone not null default now(),
  updated_at     timestamp with time zone not null default now(),

  -- prevent duplicate signups per storefront
  constraint newsletter_subscribers_email_storefront_unique unique (email, storefront_id)
);

-- fast lookups filtered by storefront
create index if not exists newsletter_subscribers_storefront_id_idx
  on public.newsletter_subscribers (storefront_id);

-- fast lookups by email (e.g. unsubscribe flows)
create index if not exists newsletter_subscribers_email_idx
  on public.newsletter_subscribers (email);

-- auto-bump updated_at on any row change
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger newsletter_subscribers_set_updated_at
  before update on public.newsletter_subscribers
  for each row execute procedure public.set_updated_at();
