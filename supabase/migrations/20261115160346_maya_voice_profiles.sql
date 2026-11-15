-- Maya profiles keep the user's exact reference transcript and use their own HF quota.
alter table public.voice_profiles
  add column provider text not null default 'cartesia',
  add column reference_text text;

alter table public.voice_profiles
  add constraint voice_profiles_provider_check
    check (provider in ('cartesia', 'maya')),
  add constraint voice_profiles_reference_text_check
    check (reference_text is null or length(reference_text) between 1 and 2000);

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
       or new.status is distinct from old.status
       or new.provider is distinct from old.provider then
      raise exception 'Voice provider fields are managed by the Creovanta API';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_voice_profile_provider_fields on public.voice_profiles;

create trigger guard_voice_profile_provider_fields
before insert or update of provider_voice_id, status, provider
on public.voice_profiles
for each row
execute function public.guard_voice_profile_provider_fields();
