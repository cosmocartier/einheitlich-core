-- Migration: create newsletter_subscribers table
-- Multi-storefront aware: each row is scoped to a storefront_id

create table if not exists public.newsletter_subscribers (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  storefront_id  uuid not null references public.storefronts(id) on delete cascade,
  source         text not null default 'early_access',  -- which form/channel collected this
  status         text not null default 'active',        -- active | unsubscribed
  created_at     timestamp with time zone not null default now(),
  updated_at     timestamp with time zone not null default now(),

  -- Prevent duplicate emails per storefront
  constraint newsletter_subscribers_email_storefront_unique unique (email, storefront_id)
);

-- Index for fast lookups by storefront
create index if not exists newsletter_subscribers_storefront_id_idx
  on public.newsletter_subscribers (storefront_id);

-- Index for fast lookups by email
create index if not exists newsletter_subscribers_email_idx
  on public.newsletter_subscribers (email);
