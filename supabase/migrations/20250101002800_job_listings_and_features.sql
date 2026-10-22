-- Careers page + feature switches.
--
-- Two new public pages ship dark or ready-to-fill:
--   * Careers is hidden until an admin flips `features.careers_page` (the
--     listing table exists so jobs can be prepared ahead of launch).
--   * Model submissions are switched off until there are enough people to
--     review them. `features.model_submissions` is enforced in RLS as well as
--     the UI, so a determined client cannot slip a submission past the switch.
--
-- Both switches are ordinary platform_settings values: an admin with
-- settings.manage (or full admin) turns them on in the admin console.

insert into public.platform_settings(key, value) values
  ('features.careers_page', 'false'::jsonb),
  ('features.model_submissions', 'false'::jsonb)
on conflict (key) do nothing;

-- Public read-only feature check used by the static frontend. Missing keys are
-- treated as off, so an older deployment without the row stays safe.
create or replace function public.feature_enabled(p_key text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select case
      when jsonb_typeof(value) = 'boolean' then (value #>> '{}')::boolean
      when jsonb_typeof(value) = 'string' then lower(value #>> '{}') in ('true','on','1','yes')
      when jsonb_typeof(value) = 'number' then (value #>> '{}')::numeric <> 0
      else false
    end
    from public.platform_settings
    where key = 'features.' || p_key
  ), false);
$$;

grant execute on function public.feature_enabled(text) to anon, authenticated;

-- ------- careers: job listings -------
create table public.job_listings (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 1 and 80),
  title jsonb not null check (title ? 'en'),
  summary jsonb,
  description jsonb,
  department text,
  employment_type text not null default 'full_time'
    check (employment_type in ('full_time','part_time','contract','internship')),
  location_id uuid references public.locations(id) on delete set null,
  is_remote boolean not null default false,
  -- A listing is only public while it is published and not past its closing date.
  is_published boolean not null default false,
  sort_order smallint not null default 0,
  closes_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger job_listings_updated_at before update on public.job_listings
  for each row execute function public.tg_set_updated_at();

create index job_listings_public_idx on public.job_listings(is_published, closes_at, sort_order);

alter table public.job_listings enable row level security;

create policy job_listings_public_read on public.job_listings
  for select using (
    (is_published = true and (closes_at is null or closes_at > now()))
    or public.has_permission('jobs.manage')
  );
create policy job_listings_manage on public.job_listings
  for all to authenticated using (public.has_permission('jobs.manage'))
  with check (public.has_permission('jobs.manage'));

-- ------- model submissions switch -------
-- The switch is checked alongside every owner write. Reviewers with
-- submissions.review keep working (their policies are separate), so an admin
-- can still clear the queue after the feature is switched off.

drop policy if exists submissions_owner_insert on public.model_submissions;
create policy submissions_owner_insert on public.model_submissions
  for insert with check (
    auth.uid() = submitter_id and public.feature_enabled('model_submissions')
  );

drop policy if exists submissions_owner_write_draft on public.model_submissions;
create policy submissions_owner_write_draft on public.model_submissions
  for update using (
    auth.uid() = submitter_id and status in ('draft','changes_requested')
    and public.feature_enabled('model_submissions')
  ) with check (
    auth.uid() = submitter_id and status in ('draft','changes_requested','pending_review')
    and public.feature_enabled('model_submissions')
  );

drop policy if exists submission_materials_owner_write on public.model_submission_materials;
create policy submission_materials_owner_write on public.model_submission_materials
  for all using (
    exists (select 1 from public.model_submissions s where s.id = submission_id and s.submitter_id = auth.uid()
             and s.status in ('draft','changes_requested'))
    and public.feature_enabled('model_submissions')
  ) with check (
    exists (select 1 from public.model_submissions s where s.id = submission_id and s.submitter_id = auth.uid()
             and s.status in ('draft','changes_requested'))
    and public.feature_enabled('model_submissions')
  );

-- Uploading a model file is part of submitting one; close the bucket too.
drop policy if exists "owner write submissions" on storage.objects;
create policy "owner write submissions" on storage.objects
  for insert with check (
    bucket_id = 'submission-assets'
    and (auth.uid()::text) = (storage.foldername(name))[1]
    and public.feature_enabled('model_submissions')
  );

-- Existing drafts can be tidied up even while submissions are closed.
drop policy if exists submissions_owner_delete_draft on public.model_submissions;
create policy submissions_owner_delete_draft on public.model_submissions
  for delete to authenticated using (submitter_id = auth.uid() and status = 'draft');
