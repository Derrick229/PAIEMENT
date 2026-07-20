-- À exécuter une seule fois dans Supabase : SQL Editor > New query > colle tout > Run

create table if not exists transactions (
  id serial primary key,
  order_id text unique not null,
  transaction_id text unique,
  quantity_liters numeric not null,
  price_per_liter numeric not null,
  amount numeric not null,
  status text not null default 'PENDING', -- PENDING | SUCCESS | FAILED
  source text,
  reason text,
  customer_email text,
  description text,
  delivered boolean not null default false,
  quantity_delivered numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_transactions_created_at on transactions (created_at desc);
create index if not exists idx_transactions_status on transactions (status);

create table if not exists settings (
  key text primary key,
  value text not null
);

-- Valeurs par défaut (modifie le prix si besoin, ou fais-le depuis la page admin après)
insert into settings (key, value) values ('price_per_liter', '500')
  on conflict (key) do nothing;
insert into settings (key, value) values ('tank_remaining_liters', '0')
  on conflict (key) do nothing;
insert into settings (key, value) values ('tank_capacity_liters', '1000')
  on conflict (key) do nothing;
