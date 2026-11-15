-- The product has one Creovanta speech workflow; provider labels are no longer part of user profiles.
drop trigger if exists guard_voice_profile_provider_fields on public.voice_profiles;
drop function if exists public.guard_voice_profile_provider_fields();

alter table public.voice_profiles
  drop constraint if exists voice_profiles_provider_check;

alter table public.voice_profiles
  drop column if exists provider;

create or replace function public.guard_voice_profile_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  request_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if tg_op = 'INSERT' then
    if new.status <> 'processing' then
      raise exception 'Voice processing status is managed by Creovanta';
    end if;
  elsif tg_op = 'UPDATE' and request_role <> 'service_role' then
    if new.status is distinct from old.status then
      raise exception 'Voice processing status is managed by Creovanta';
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_voice_profile_status
before insert or update of status
on public.voice_profiles
for each row
execute function public.guard_voice_profile_status();
