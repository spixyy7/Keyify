create extension if not exists pgcrypto;

create table if not exists public.feedbacks (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  category text not null check (category in ('nalog', 'rad_sajta', 'predlog', 'zalba')),
  message text not null,
  page_url text,
  status text not null default 'new' check (status in ('new', 'reviewed', 'closed')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_feedbacks_category_created_at
  on public.feedbacks (category, created_at desc);

create index if not exists idx_feedbacks_status_created_at
  on public.feedbacks (status, created_at desc);

alter table if exists public.site_settings
  add column if not exists global_warranty_text text,
  add column if not exists facebook_url text,
  add column if not exists twitter_url text,
  add column if not exists instagram_url text,
  add column if not exists facebook_animation text default 'float',
  add column if not exists twitter_animation text default 'float',
  add column if not exists instagram_animation text default 'float',
  add column if not exists social_animation_type text default 'float';

insert into public.site_settings (
  id,
  global_warranty_text,
  social_animation_type,
  facebook_animation,
  twitter_animation,
  instagram_animation
)
select
  1,
  '',
  'float',
  'float',
  'float',
  'float'
where not exists (
  select 1
  from public.site_settings
  where id = 1
);
