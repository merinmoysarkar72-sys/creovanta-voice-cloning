-- Retire the previous speech vendor and make Creovanta's current speech workflow the only provider.
-- Remove the legacy trigger first so old provider profiles can be marked unusable safely.
drop trigger if exists guard_voice_profile_provider_fields on public.voice_profiles;
drop function if exists public.guard_voice_profile_provider_fields();

-- Old vendor profiles cannot be migrated as usable clones: require a fresh reference sample/transcript.
update public.voice_profiles
set provider = 'maya',
    status = 'failed'
where provider <> 'maya';

alter table public.voice_profiles
  alter column provider set default 'maya';

alter table public.voice_profiles
  drop constraint if exists voice_profiles_provider_check;

alter table public.voice_profiles
  add constraint voice_profiles_provider_check
  check (provider = 'maya');

drop index if exists public.voice_profiles_provider_voice_id_uidx;
alter table public.voice_profiles
  drop column if exists provider_voice_id;

create or replace function public.guard_voice_profile_provider_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  request_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if tg_op = 'INSERT' then
    if new.status <> 'processing' or new.provider <> 'maya' then
      raise exception 'Voice processing fields are managed by Creovanta';
    end if;
  elsif tg_op = 'UPDATE' and request_role <> 'service_role' then
    if new.status is distinct from old.status
       or new.provider is distinct from old.provider then
      raise exception 'Voice processing fields are managed by Creovanta';
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_voice_profile_provider_fields
before insert or update of status, provider
on public.voice_profiles
for each row
execute function public.guard_voice_profile_provider_fields();
