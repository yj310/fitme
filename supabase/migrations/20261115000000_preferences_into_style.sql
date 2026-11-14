-- 취향 and 추구미 are one concept now (decision 13): fit and avoided colors/items live in each 추구미
-- (style_profiles.attributes). Copy what onboarding stored on users into every 추구미 the user has, so
-- nothing they told us is lost. The old users columns stay (unused) and can be dropped later.

update public.style_profiles sp
set attributes = jsonb_set(
  jsonb_set(
    sp.attributes,
    '{avoid}',
    jsonb_build_object(
      'subcategories', (
        select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
        from (
          select jsonb_array_elements_text(coalesce(sp.attributes -> 'avoid' -> 'subcategories', '[]'::jsonb)) as x
          union
          select unnest(u.avoid_subcategories)
        ) s
      ),
      'colors', (
        select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
        from (
          select jsonb_array_elements_text(coalesce(sp.attributes -> 'avoid' -> 'colors', '[]'::jsonb)) as x
          union
          select unnest(u.avoid_colors)
        ) s
      )
    )
  ),
  '{silhouette}',
  jsonb_build_object(
    'top', case when u.preferred_fit is not null then jsonb_build_array(u.preferred_fit)
                else coalesce(sp.attributes -> 'silhouette' -> 'top', '[]'::jsonb) end,
    'bottom', coalesce(sp.attributes -> 'silhouette' -> 'bottom', '[]'::jsonb)
  )
)
from public.users u
where u.id = sp.user_id;
