-- Listoの端末間同期用テーブル（既存同期との互換性のためテーブル名はtempo_snapshotsを維持）
-- Supabase Dashboard > SQL Editor で一度だけ実行してください。

create table if not exists public.tempo_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  client_updated_at bigint not null,
  device_id text not null,
  updated_at timestamptz not null default now()
);

alter table public.tempo_snapshots enable row level security;

grant select, insert, update, delete on public.tempo_snapshots to authenticated;

drop policy if exists "tempo_select_own_snapshot" on public.tempo_snapshots;
create policy "tempo_select_own_snapshot"
on public.tempo_snapshots for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "tempo_insert_own_snapshot" on public.tempo_snapshots;
create policy "tempo_insert_own_snapshot"
on public.tempo_snapshots for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "tempo_update_own_snapshot" on public.tempo_snapshots;
create policy "tempo_update_own_snapshot"
on public.tempo_snapshots for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "tempo_delete_own_snapshot" on public.tempo_snapshots;
create policy "tempo_delete_own_snapshot"
on public.tempo_snapshots for delete
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.set_tempo_snapshot_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tempo_snapshot_updated_at on public.tempo_snapshots;
create trigger tempo_snapshot_updated_at
before update on public.tempo_snapshots
for each row execute function public.set_tempo_snapshot_updated_at();
