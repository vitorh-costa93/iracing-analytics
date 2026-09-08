-- 08/09/2026: "eu queria um pouco mais de telemetria... fala que estou mais próximo da volta mais
-- rápida, mas por quê? Fiquei distante, mas por quê?" -- adiciona o ponto de frenagem por curva
-- (lib/telemetry-corner-brakes.ts) ao cache já existente em telemetry_features, pra explicar o gap
-- pra melhor volta em vez de só reportar o número. jsonb porque o número de curvas varia por pista.
alter table public.telemetry_features
  add column if not exists corner_brakes jsonb;
