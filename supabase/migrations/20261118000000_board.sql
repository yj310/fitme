-- 피드백 게시판 (decision 14): testers report bugs and ideas with screenshots from any screen; the admin
-- manages them (접수 · 해결 중 · 해결됨 · 보류) and replies. Not to be confused with public.feedback,
-- which holds feedback on outfits inside the chat.
--
-- Users may only write their own posts and comments, and only the columns listed in the grants below:
-- status, admin replies and admin_updated_at are written by the server (service role) after it checked
-- that the caller is an admin (ADMIN_USER_IDS in the API's environment).

create table public.board_posts (
  id               bigint generated always as identity primary key,   -- shown as #12
  user_id          uuid not null references public.users (id) on delete cascade,
  kind             text not null check (kind in ('bug', 'idea', 'etc')),
  body             text not null check (char_length(body) between 1 and 2000),
  status           text not null default 'new' check (status in ('new', 'doing', 'done', 'hold')),
  page             text check (char_length(page) <= 120),               -- screen it was written on
  device           text check (char_length(device) <= 80),              -- e.g. "iPhone · Safari"
  image_paths      text[] not null default '{}' check (cardinality(image_paths) <= 6),
  admin_updated_at timestamptz,                                          -- last status change or reply
  author_seen_at   timestamptz,                                          -- author opened '내 피드백'
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index board_posts_user_idx on public.board_posts (user_id, created_at desc);
create index board_posts_status_idx on public.board_posts (status, created_at desc);

create table public.board_comments (
  id          bigint generated always as identity primary key,
  post_id     bigint not null references public.board_posts (id) on delete cascade,
  user_id     uuid references public.users (id) on delete set null,
  is_admin    boolean not null default false,
  kind        text not null default 'comment' check (kind in ('comment', 'status')),
  body        text not null default '' check (char_length(body) <= 2000),
  status      text check (status in ('new', 'doing', 'done', 'hold')),  -- for kind = 'status'
  image_paths text[] not null default '{}' check (cardinality(image_paths) <= 6),
  created_at  timestamptz not null default now()
);
create index board_comments_post_idx on public.board_comments (post_id, created_at);

alter table public.board_posts enable row level security;
alter table public.board_comments enable row level security;

create policy board_posts_own on public.board_posts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Read every comment on your own posts (including the admin's); write only your own, as a non-admin.
create policy board_comments_read_own_posts on public.board_comments
  for select to authenticated
  using (exists (select 1 from public.board_posts p where p.id = post_id and p.user_id = auth.uid()));
create policy board_comments_insert_own on public.board_comments
  for insert to authenticated
  with check (
    user_id = auth.uid() and is_admin = false and kind = 'comment'
    and exists (select 1 from public.board_posts p where p.id = post_id and p.user_id = auth.uid())
  );

revoke all on public.board_posts, public.board_comments from anon, authenticated;
grant select on public.board_posts, public.board_comments to authenticated;
grant insert (user_id, kind, body, page, device, image_paths) on public.board_posts to authenticated;
grant update (author_seen_at) on public.board_posts to authenticated;
grant insert (post_id, user_id, body, image_paths) on public.board_comments to authenticated;

-- ───────────────────────── Storage: private "board" bucket ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('board', 'board', false, 5242880, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

-- {user_id}/{uuid}.webp — owners read and write their own folder; the admin's server signs URLs.
create policy board_read_own on storage.objects
  for select to authenticated
  using (bucket_id = 'board' and (storage.foldername(name))[1] = auth.uid()::text);
create policy board_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'board' and (storage.foldername(name))[1] = auth.uid()::text);
create policy board_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'board' and (storage.foldername(name))[1] = auth.uid()::text);
