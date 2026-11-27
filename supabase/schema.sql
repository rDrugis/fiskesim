-- Fiskesim: brukere og fangstlogg (kjørt i Supabase SQL Editor 27.11.2026)
-- Hver bruker ser og endrer bare sine egne fangster; admin (profiles.is_admin) kan lese alle.
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_.-]{2,24}$'),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.catches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  client_id text not null,
  caught_at timestamptz not null,
  species text,
  count int not null default 1 check (count >= 0),
  weight_kg numeric check (weight_kg >= 0),
  length_cm numeric check (length_cm >= 0),
  released boolean not null default false,
  no_catch boolean not null default false,
  effort_min int check (effort_min >= 0),
  lon double precision not null,
  lat double precision not null,
  depth_m numeric,
  gear text,
  bait text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);
create index catches_user_time on public.catches (user_id, caught_at desc);
create function public.is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from public.profiles where id = auth.uid()), false) $$;
create function public.new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id, username) values (new.id, lower(new.raw_user_meta_data->>'username')); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.new_user();
alter table public.profiles enable row level security;
alter table public.catches enable row level security;
create policy "egen profil" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "les egne" on public.catches for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "lag egne" on public.catches for insert to authenticated with check (user_id = auth.uid());
create policy "endre egne" on public.catches for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "slett egne" on public.catches for delete to authenticated using (user_id = auth.uid());
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.catches to authenticated;
-- Algoritmeforslaget fangsten ble logget fra (art, poeng, måned)
alter table public.catches add column algo jsonb;
