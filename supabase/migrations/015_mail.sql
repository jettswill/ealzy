begin;

create table if not exists public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  email text not null,
  provider text not null default 'custom',
  username text not null,
  imap_host text not null,
  imap_port integer not null default 993,
  smtp_host text not null,
  smtp_port integer not null default 465,
  secret_cipher text not null,
  status text not null default 'active',
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, email)
);

create index if not exists mail_accounts_owner_idx on public.mail_accounts (owner_id);
create index if not exists mail_accounts_sync_idx on public.mail_accounts (status, last_synced_at);

create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  account_id uuid not null references public.mail_accounts(id) on delete cascade,
  provider_uid text not null,
  from_address text not null default '',
  from_name text,
  to_address text,
  subject text not null default '',
  snippet text not null default '',
  received_at timestamptz,
  is_important boolean not null default false,
  is_meeting boolean not null default false,
  meeting_at timestamptz,
  has_calendar_invite boolean not null default false,
  handled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider_uid)
);

create index if not exists mail_messages_owner_idx
  on public.mail_messages (owner_id, received_at desc);
create index if not exists mail_messages_important_idx
  on public.mail_messages (owner_id, is_important, handled, received_at desc);

create table if not exists public.mail_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  account_id uuid not null references public.mail_accounts(id) on delete cascade,
  message_id uuid references public.mail_messages(id) on delete set null,
  to_address text not null,
  subject text not null default '',
  body text not null default '',
  status text not null default 'draft',
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mail_drafts_owner_idx
  on public.mail_drafts (owner_id, created_at desc);

create table if not exists public.mail_playbooks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  account_id uuid references public.mail_accounts(id) on delete cascade,
  name text not null,
  trigger text not null,
  actions text[] not null default '{}',
  prompt text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mail_playbooks_owner_idx on public.mail_playbooks (owner_id);

commit;
