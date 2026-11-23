-- VoidStrike — tabela de perfis (progresso do jogador sincronizado por conta).
--
-- Esta tabela já existe no projeto Supabase (foi criada numa sessão anterior,
-- juntamente com um trigger que cria a linha automaticamente a partir dos
-- metadados do signup). Este ficheiro é apenas documentação/idempotente:
-- corre-o só se precisares de recriar o esquema do zero (ex: projeto novo).
-- É seguro correr várias vezes — não apaga nem sobrescreve dados existentes.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null default 'Operador',
  level integer not null default 1,
  xp integer not null default 0,
  coins integer not null default 2500,
  diamonds integer not null default 300,
  matches integer not null default 0,
  kills integer not null default 0,
  best_score integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: leitura pública" on public.profiles;
create policy "profiles: leitura pública" on public.profiles
  for select using (true);

drop policy if exists "profiles: criar o próprio" on public.profiles;
create policy "profiles: criar o próprio" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles: atualizar o próprio" on public.profiles;
create policy "profiles: atualizar o próprio" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Trigger: cria automaticamente a linha de perfil quando uma conta é criada,
-- lendo o nome de operador dos metadados do signup (signUp({ data: { username } })).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', 'Operador'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
