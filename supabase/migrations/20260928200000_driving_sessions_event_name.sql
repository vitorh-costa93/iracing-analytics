-- 28/09/2026: driving_sessions.event_type sozinho não distingue corridas online de corridas offline
-- contra IA -- confirmado empiricamente que ambas usam event_type = 1 quando session_type = 3 (a
-- corrida offline usada para testar o overlay tem o mesmo event_type da corrida oficial "Formula B -
-- Super Formula Series"). O campo que realmente diferencia só existe na resposta bruta da API interna
-- do Garage61 (GET /api/internal/events/{id}): "name" no evento ("Offline (AI)" vs o nome da série
-- oficial), e só o bookmarklet (public/garage61-import.js) tem acesso a essa API -- o fallback
-- server-side (sync/incremental, API pública) não expõe esse campo, então event_name continua null
-- para sessões sincronizadas só por ele até o bookmarklet visitar o mesmo evento de novo.
alter table public.driving_sessions
  add column if not exists event_name text;

comment on column public.driving_sessions.event_name is
  'Nome bruto do evento na API interna do Garage61 (ex: "Offline (AI)" para testes contra IA, ou o nome da série oficial). Só preenchido via bookmarklet (public/garage61-import.js -> /api/sync/garage61-laps); sync/incremental (API pública) não tem acesso a esse campo e sempre grava null. Usado para excluir corridas/práticas offline da Semana Ativa e do Race Debrief.';
