-- Onboarding asks gender first so fit and style pictures match the user (female / male).
-- Used only to pick reference pictures in the app; never sent to the AI.
alter table public.users
  add column if not exists gender text check (gender is null or gender in ('female', 'male'));
