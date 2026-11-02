-- Tarkov Hub: аккаунты и прогресс квестов.
-- Запустить один раз в Supabase: Dashboard → SQL Editor → New query → вставить весь файл → Run.
-- Discord ID игроков сюда НЕ вписываются: их добавляют отдельным запросом прямо в Supabase (см. README).

-- Белый список игроков: Discord ID (число из «Копировать ID пользователя»).
create table if not exists public.allowed_players (
  discord_id text primary key check (discord_id ~ '^[0-9]{5,25}$'),
  note text
);

-- Одна строка = квест выполнен. Снятие отметки удаляет строку.
create table if not exists public.quest_progress (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  mode text not null check (mode in ('regular', 'pve')),
  quest_id text not null check (length(quest_id) between 1 and 64),
  updated_at timestamptz not null default now(),
  primary key (user_id, mode, quest_id)
);

alter table public.allowed_players enable row level security;
alter table public.quest_progress enable row level security;

-- Таблицы не открыты для анонимов. allowed_players вообще недоступна клиентам (нет прав и нет политик).
revoke all on public.allowed_players from anon, authenticated;
revoke all on public.quest_progress from anon, authenticated;
grant select, insert, delete on public.quest_progress to authenticated;

-- Проверка «игрок в списке». Живёт в закрытой схеме, которую не видно через API.
-- security definer нужен, чтобы читать auth.identities и allowed_players; смотрит только на текущего пользователя.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_allowed_player()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from auth.identities i
    join public.allowed_players p on p.discord_id = i.provider_id
    where i.user_id = auth.uid() and i.provider = 'discord'
  );
$$;
revoke all on function private.is_allowed_player() from public, anon;
grant execute on function private.is_allowed_player() to authenticated;

-- Для сайта: «пустят ли меня?». Возвращает ответ только про самого вызывающего.
create or replace function public.am_i_allowed()
returns boolean
language sql stable security invoker set search_path = ''
as $$ select private.is_allowed_player(); $$;
revoke all on function public.am_i_allowed() from public, anon;
grant execute on function public.am_i_allowed() to authenticated;

-- Свой прогресс и только для игроков из списка. (select …) — чтобы проверка выполнялась один раз на запрос.
drop policy if exists "own progress, allowed players only" on public.quest_progress;
drop policy if exists "progress: read own" on public.quest_progress;
drop policy if exists "progress: add own" on public.quest_progress;
drop policy if exists "progress: remove own" on public.quest_progress;

create policy "progress: read own" on public.quest_progress
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed_player()));

create policy "progress: add own" on public.quest_progress
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_allowed_player()));

create policy "progress: remove own" on public.quest_progress
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed_player()));
