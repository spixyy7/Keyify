do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'support_tickets'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.support_tickets drop constraint if exists %I', constraint_name);
  end loop;
exception
  when undefined_table then
    null;
end $$;

alter table if exists public.support_tickets
  add column if not exists reply_text text,
  add column if not exists replied_at timestamptz;

alter table if exists public.support_tickets
  add constraint support_tickets_status_check
  check (status in ('open', 'replied', 'closed'));
