-- Private, bounded product-use events. Context is deliberately limited by the API route: no
-- telemetry payload, setup filename/content or free-text engineer prompt is retained here.
create table if not exists public.ui_interaction_events (
  id bigint generated always as identity primary key,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  event_name text not null check (event_name in (
    'overview_week_context_opened', 'telemetry_tab_selected', 'telemetry_context_selected',
    'telemetry_opportunity_opened', 'debrief_category_selected', 'debrief_evidence_opened',
    'setup_comparison_completed', 'setup_engineer_prompt_selected', 'setup_engineer_recommendation_requested'
  )),
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ui_interaction_events_driver_created_idx
  on public.ui_interaction_events (driver_id, created_at desc);
alter table public.ui_interaction_events enable row level security;
comment on table public.ui_interaction_events is 'Private low-volume UI decisions for UX validation; no raw telemetry, setup data or free text.';
