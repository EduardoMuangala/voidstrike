-- VoidStrike — tabela de perfis (progresso do jogador sincronizado por conta).
-- Corre isto uma vez no SQL editor do teu projeto Supabase.
-- É idempotente: podes correr várias vezes sem problema.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null default 'Operador',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: ler o próprio" on public.profiles;
create policy "profiles: ler o próprio" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles: criar o próprio" on public.profiles;
create policy "profiles: criar o próprio" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles: atualizar o próprio" on public.profiles;
create policy "profiles: atualizar o próprio" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
