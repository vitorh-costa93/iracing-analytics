-- Log de uso/custo das chamadas à OpenAI (custo ESTIMADO pela tabela de preços em lib/ai-models.ts).
-- Acesso só pela camada servidor (service role); RLS ligado sem policies.
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  task text not null,
  model text not null,
  ok boolean not null default true,
  input_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  output_tokens integer not null default 0,
  reasoning_tokens integer not null default 0,
  cost_usd numeric(10, 6),
  duration_ms integer,
  error text
);

create index if not exists ai_usage_created_at_idx on public.ai_usage (created_at desc);

alter table public.ai_usage enable row level security;

comment on table public.ai_usage is
  'Log de chamadas à OpenAI (tokens e custo estimado). Acesso só server-side via service role.';
