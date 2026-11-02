-- Tarkov Hub: просмотр прогресса команды.
-- Запустить один раз ПОСЛЕ setup.sql: Dashboard → SQL Editor → New query → вставить весь файл → Run.
-- Можно запускать повторно — ничего не сломается.
-- Что меняется: игроки из списка видят профили и отметки друг друга. Менять по-прежнему можно только свои.

-- Профиль игрока: имя и аватар из Discord, чтобы показывать, чей это прогресс
create table if not exists public.players (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  name text not null check (length(name) between 1 and 64),
  avatar text check (avatar is null or avatar like 'https://cdn.discordapp.com/%'),
  updated_at timestamptz not null default now()
);
alter table public.players enable row level security;
revoke all on public.players from anon, authenticated;
grant select, insert, update on public.players to authenticated; -- user_id менять нельзя: это проверяют политики ниже

-- Проверка «этот пользователь — игрок из списка» (нужна, чтобы видеть только участников команды)
create or replace function private.is_allowed_user(uid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from auth.identities i
    join public.allowed_players p on p.discord_id = i.provider_id
    where i.user_id = uid and i.provider = 'discord'
  );
$$;
revoke all on function private.is_allowed_user(uuid) from public, anon;
grant execute on function private.is_allowed_user(uuid) to authenticated;

-- Профили: читать — профили участников команды; создавать и менять — только свой
drop policy if exists "players: read team" on public.players;
drop policy if exists "players: add own" on public.players;
drop policy if exists "players: update own" on public.players;
create policy "players: read team" on public.players
  for select to authenticated
  using ((select private.is_allowed_player()) and private.is_allowed_user(user_id));
create policy "players: add own" on public.players
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_allowed_player()));
create policy "players: update own" on public.players
  for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed_player()))
  with check (user_id = (select auth.uid()) and (select private.is_allowed_player()));

-- Прогресс: читать — свой и участников команды; добавлять и удалять — только свой (политики из setup.sql остаются)
drop policy if exists "progress: read own" on public.quest_progress;
drop policy if exists "progress: read team" on public.quest_progress;
create policy "progress: read team" on public.quest_progress
  for select to authenticated
  using ((select private.is_allowed_player()) and private.is_allowed_user(user_id));
