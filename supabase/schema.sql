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
-- Forholdene da fisken ble tatt (vær, tidevann, måne) og «andres fisk» som ikke teller i topplisten
alter table public.catches add column if not exists env jsonb;
alter table public.catches add column if not exists andres boolean not null default false;
-- Toppliste mellom alle med konto: bare tall per bruker, ingen posisjoner (kjørt 28.11.2026)
create or replace function public.toppliste(fra timestamptz, til timestamptz)
returns table (username text, fisk bigint, kg numeric, arter bigint, uten_fangst bigint)
language sql stable security definer set search_path = public as $$
  select p.username,
         coalesce(sum(c.count) filter (where not c.no_catch and not c.andres), 0),
         coalesce(sum(c.weight_kg) filter (where not c.no_catch and not c.andres), 0),
         count(distinct c.species) filter (where not c.no_catch and not c.andres and c.species is not null and c.species <> 'ukjent'),
         count(*) filter (where c.no_catch)
  from public.profiles p
  left join public.catches c on c.user_id = p.id and c.caught_at >= fra and c.caught_at < til
  group by p.username
$$;
revoke all on function public.toppliste(timestamptz, timestamptz) from public, anon;
grant execute on function public.toppliste(timestamptz, timestamptz) to authenticated;
-- Ingen banneord i brukernavn (samme liste som badUser i src/fangst/cloud.js), 28.11.2026
alter table public.profiles add constraint profiles_username_ok check (
  regexp_replace(translate(lower(username), '013457@$!|', 'oieastasii'), '[^a-z]', '', 'g')
  !~ '(faen|fanden|helvete|jaevel|jaevl|javel|javl|satan|dritt|fitte|fitta|kuk|pikk|hore|horunge|rasshol|raevhol|neger|nigg|fuck|fck|shit|bitch|cunt|dick|cock|pussy|whore|slut|faggot|voldt|rape|retard|nazi|hitler|mongo|porn|sex)'
);
-- Valgfritt brukernavn på den som fikk fisken når den er logget som «andres fisk», 28.11.2026
alter table public.catches add column if not exists andres_navn text;
