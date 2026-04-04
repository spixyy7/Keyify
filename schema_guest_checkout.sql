create extension if not exists pgcrypto;

create unique index if not exists users_email_unique_idx
  on users (lower(email));

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid unique,
  user_id uuid references users(id) on delete set null,
  buyer_email text not null,
  guest_token uuid unique,
  product_id uuid references products(id) on delete set null,
  product_name text,
  product_image text,
  amount numeric(10, 2) not null default 0,
  payment_method text,
  status text not null default 'pending',
  delivery_payload text,
  proof_uploaded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists orders
  alter column user_id drop not null;

alter table if exists orders
  add column if not exists transaction_id uuid,
  add column if not exists buyer_email text,
  add column if not exists guest_token uuid,
  add column if not exists product_id uuid,
  add column if not exists product_name text,
  add column if not exists product_image text,
  add column if not exists amount numeric(10, 2) not null default 0,
  add column if not exists payment_method text,
  add column if not exists status text not null default 'pending',
  add column if not exists delivery_payload text,
  add column if not exists proof_uploaded boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists orders_transaction_id_unique_idx
  on orders (transaction_id)
  where transaction_id is not null;

create unique index if not exists orders_guest_token_unique_idx
  on orders (guest_token)
  where guest_token is not null;

create index if not exists orders_buyer_email_idx
  on orders (lower(buyer_email));

create index if not exists orders_user_id_idx
  on orders (user_id);
