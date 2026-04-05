alter table if exists public.support_tickets
  add column if not exists reply_text text,
  add column if not exists replied_at timestamptz;

create index if not exists idx_support_tickets_status_created_at
  on public.support_tickets (status, created_at desc);
