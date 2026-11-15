-- Per-profile Cartesia voice mapping and client-side field protection.
alter table public.voice_profiles
  add column if not exists provider_voice_id text;

create unique index if not exists voice_profiles_provider_voice_id_uidx
  on public.voice_profiles(provider_voice_id)
  where provider_voice_id is not null;

create or replace function public.guard_voice_profile_provider_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  request_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if tg_op = 'INSERT' then
    if new.provider_voice_id is not null or new.status <> 'processing' then
      raise exception 'Voice provider fields are managed by the Creovanta API';
    end if;
  elsif tg_op = 'UPDATE' and request_role <> 'service_role' then
    if new.provider_voice_id is distinct from old.provider_voice_id
       or new.status is distinct from old.status then
      raise exception 'Voice provider fields are managed by the Creovanta API';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_voice_profile_provider_fields on public.voice_profiles;

create trigger guard_voice_profile_provider_fields
before insert or update of provider_voice_id, status
on public.voice_profiles
for each row
execute function public.guard_voice_profile_provider_fields();
