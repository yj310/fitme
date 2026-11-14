-- FITME P1 initial schema (spec ch.12)
-- Every user table has RLS: a user can only touch their own rows.
-- The API calls PostgREST with the user's own JWT, so RLS applies to normal requests.
-- The service role is used only for weather_cache, account deletion, and admin tasks.

create extension if not exists pgcrypto;

-- ───────────────────────── users ─────────────────────────
create table public.users (
  id                uuid primary key references auth.users (id) on delete cascade,
  nickname          text,
  email             text,                      -- not collected (kept for future)
  login_provider    text not null default 'kakao',
  avatar_url        text,
  preferred_fit     text,
  style_tags        text[] not null default '{}' check (cardinality(style_tags) <= 3),
  avoid_colors      text[] not null default '{}',
  avoid_subcategories text[] not null default '{}',   -- added: onboarding "피하는 아이템"
  personal_color    text,                      -- added: profile screen asks for it (optional)
  home_region       text,
  region_code       text,
  grid_nx           int,
  grid_ny           int,
  height_cm         int check (height_cm is null or height_cm between 100 and 230),
  usual_sizes       jsonb not null default '{}'::jsonb,
  body_traits       text[] not null default '{}',
  body_measurements jsonb,
  onboarding_state  jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Create the profile row when someone signs up (Kakao gives nickname + avatar, no email).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, nickname, avatar_url, login_provider)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'nickname',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'user_name',
      '사용자'
    ),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    coalesce(new.raw_app_meta_data ->> 'provider', 'kakao')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── clothing_items ─────────────────────────
create table public.clothing_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users (id) on delete cascade,
  image_path     text,
  name           text not null,
  category       text not null check (category in ('outer','top','bottom','dress','shoes')),
  subcategory    text not null,
  color          text not null,
  pattern        text not null default 'solid',
  fit            text not null default 'none',
  material       text,
  seasons        text[] not null default '{}',
  style_tags     text[] not null default '{}' check (cardinality(style_tags) <= 3),
  formality      smallint not null default 2 check (formality between 1 and 3),
  warmth         smallint not null default 2 check (warmth between 1 and 3),
  brand          text,
  size_label     text,
  memo           text,
  tag_confidence jsonb not null default '{}'::jsonb,
  tag_source     text not null default 'manual' check (tag_source in ('ai','user_edited','manual')),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index clothing_items_user_idx on public.clothing_items (user_id, is_active, category);

-- ───────────────────────── style_profiles ─────────────────────────
create table public.style_profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  style_name  text not null,
  source_text text,
  preset_key  text,
  attributes  jsonb not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index style_profiles_one_default on public.style_profiles (user_id) where is_default;

-- ───────────────────────── conversations / chat_messages ─────────────────────────
-- Added: the spec has conversation_id but no table. Needed for "continue latest chat"
-- and for constraints that accumulate within one conversation.
create table public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  title      text,
  state      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_user_idx on public.conversations (user_id, updated_at desc);

create table public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  content         text not null default '',
  payload         jsonb,          -- steps / outfits / ask shown with the message
  created_at      timestamptz not null default now()
);
create index chat_messages_conv_idx on public.chat_messages (conversation_id, created_at);

-- ───────────────────────── agent_runs ─────────────────────────
create table public.agent_runs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  source          text not null default 'chat' check (source in ('chat','today')),
  request_text    text,
  trace           jsonb not null default '[]'::jsonb,   -- never contains keys or body measurements
  tool_calls      int not null default 0,
  llm_provider    text,
  llm_model       text,
  is_free_tier    boolean not null default true,
  latency_ms      int,
  status          text not null default 'ok' check (status in ('ok','asked','failed')),
  created_at      timestamptz not null default now()
);
create index agent_runs_user_day_idx on public.agent_runs (user_id, created_at desc);

-- ───────────────────────── outfits / outfit_items ─────────────────────────
create table public.outfits (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  run_id           uuid references public.agent_runs (id) on delete set null,
  conversation_id  uuid references public.conversations (id) on delete set null,
  style_profile_id uuid references public.style_profiles (id) on delete set null,
  occasion         text,
  target_date      date,
  title            text not null,
  reasons          text[] not null default '{}',
  score            numeric(5,1) not null default 0,
  score_detail     jsonb not null default '{}'::jsonb,
  weather_snapshot jsonb,
  version          int not null default 1,
  rank             int not null default 1,
  label            text,
  source           text not null default 'chat' check (source in ('chat','today')),
  is_favorite      boolean not null default false,
  favorited_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index outfits_user_idx on public.outfits (user_id, created_at desc);
create index outfits_fav_idx on public.outfits (user_id, is_favorite) where is_favorite;

create table public.outfit_items (
  outfit_id        uuid not null references public.outfits (id) on delete cascade,
  clothing_item_id uuid not null references public.clothing_items (id) on delete cascade,
  user_id          uuid not null references public.users (id) on delete cascade,
  role             text not null check (role in ('outer','top','bottom','dress','shoes')),
  primary key (outfit_id, clothing_item_id)
);

-- ───────────────────────── feedback ─────────────────────────
create table public.feedback (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  outfit_id     uuid references public.outfits (id) on delete set null,
  feedback_type text not null,      -- exclude_item | exclude_subcategory | ... | reroll
  target        text,
  scope         text[],             -- occasions this applies to (null = everywhere)
  is_persistent boolean not null default false,
  comment       text,
  created_at    timestamptz not null default now()
);
create index feedback_user_idx on public.feedback (user_id, created_at desc);

-- ───────────────────────── weather_cache (server only) ─────────────────────────
create table public.weather_cache (
  grid_nx       int not null,
  grid_ny       int not null,
  base_datetime timestamptz not null,
  forecast      jsonb not null,
  fetched_at    timestamptz not null default now(),
  primary key (grid_nx, grid_ny, base_datetime)
);

-- ───────────────────────── AI connections (BYOK) ─────────────────────────
create table public.ai_connections (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users (id) on delete cascade,
  provider          text not null check (provider in ('gemini','anthropic','openai')),
  encrypted_key     bytea not null,   -- AES-256-GCM, nonce prepended
  key_last4         text not null,
  status            text not null default 'active' check (status in ('active','invalid')),
  monthly_limit_usd numeric(10,2),
  verified_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (user_id, provider)
);

create table public.ai_task_settings (
  user_id  uuid not null references public.users (id) on delete cascade,
  task     text not null check (task in ('chat','tagging','style')),
  provider text not null,
  model    text not null,
  primary key (user_id, task)
);

create table public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  provider      text not null,
  model         text not null,
  task          text not null,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  est_cost_usd  numeric(12,6) not null default 0,
  is_free_tier  boolean not null default true,
  created_at    timestamptz not null default now()
);
create index ai_usage_user_idx on public.ai_usage (user_id, created_at desc);

-- ───────────────────────── updated_at triggers ─────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger users_touch before update on public.users
  for each row execute function public.touch_updated_at();
create trigger clothing_items_touch before update on public.clothing_items
  for each row execute function public.touch_updated_at();
create trigger conversations_touch before update on public.conversations
  for each row execute function public.touch_updated_at();

-- ───────────────────────── Row Level Security ─────────────────────────
alter table public.users            enable row level security;
alter table public.clothing_items   enable row level security;
alter table public.style_profiles   enable row level security;
alter table public.conversations    enable row level security;
alter table public.chat_messages    enable row level security;
alter table public.agent_runs       enable row level security;
alter table public.outfits          enable row level security;
alter table public.outfit_items     enable row level security;
alter table public.feedback         enable row level security;
alter table public.weather_cache    enable row level security;  -- no policies: service role only
alter table public.ai_connections   enable row level security;
alter table public.ai_task_settings enable row level security;
alter table public.ai_usage         enable row level security;

create policy users_own on public.users
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'clothing_items','style_profiles','conversations','chat_messages','agent_runs',
    'outfits','outfit_items','feedback','ai_connections','ai_task_settings','ai_usage'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_own', t
    );
  end loop;
end $$;

-- outfit_items must point at the caller's own outfit and clothing item.
create policy outfit_items_refs_own on public.outfit_items
  as restrictive for insert to authenticated
  with check (
    exists (select 1 from public.outfits o where o.id = outfit_id and o.user_id = auth.uid())
    and exists (select 1 from public.clothing_items c where c.id = clothing_item_id and c.user_id = auth.uid())
  );

-- Nobody but the server (service role) may read encrypted keys.
revoke all on public.ai_connections from anon, authenticated;
grant select (id, user_id, provider, key_last4, status, monthly_limit_usd, verified_at, created_at)
  on public.ai_connections to authenticated;
grant update (monthly_limit_usd) on public.ai_connections to authenticated;
grant delete on public.ai_connections to authenticated;

revoke all on public.weather_cache from anon, authenticated;
revoke all on all tables in schema public from anon;

-- ───────────────────────── Storage: private "closet" bucket ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('closet', 'closet', false, 5242880, array['image/webp','image/jpeg'])
on conflict (id) do nothing;

-- Paths look like {user_id}/{uuid}.webp — only the owner's folder is readable/writable.
create policy closet_read_own on storage.objects
  for select to authenticated
  using (bucket_id = 'closet' and (storage.foldername(name))[1] = auth.uid()::text);
create policy closet_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'closet' and (storage.foldername(name))[1] = auth.uid()::text);
create policy closet_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'closet' and (storage.foldername(name))[1] = auth.uid()::text);
create policy closet_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'closet' and (storage.foldername(name))[1] = auth.uid()::text);
