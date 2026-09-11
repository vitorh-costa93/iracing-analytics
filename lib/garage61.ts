const BASE_URL = "https://garage61.net/api/v1";

function getToken() {
  const token = process.env.GARAGE61_API_TOKEN;

  if (!token) {
    throw new Error("GARAGE61_API_TOKEN não configurado");
  }

  return token;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 11/09/2026: "esperei mais de 1 hora, tentei de novo e deu errado -- precisa revisar essa conexão".
// A causa raiz não era o orçamento diário estar esgotado (esperar não ajudava, sempre falhava no
// mesmo ~46s de novo) -- é a documentação oficial da Garage61
// (https://garage61.net/developer/rate-limits): "Rate limits use a continuously refilling bucket...
// You are allowed a small number of API requests in rapid succession. After this initial burst is
// consumed, capacity returns continuously at a regular rate." sync/incremental pagina /laps pra CADA
// par carro+pista recente em sequência, sem nenhuma pausa entre chamadas -- exatamente o padrão de
// rajada que esgota o "burst" logo nas primeiras dezenas de requisições, e depois toda chamada
// seguinte bate 429 até o fim do job, não importa quanto tempo passou antes de começar a rodar.
// Esperar 1h resolve o burst (a esteira reabastece), mas o PRÓXIMO job volta a esgotar o burst nos
// primeiros segundos porque continua disparando tudo sem pausa -- por isso "esperar mais" nunca
// resolvia de verdade.
//
// A correção segue a própria recomendação deles: ler os headers de rate limit em toda resposta e,
// quando a capacidade estiver baixa, pausar ANTES de esgotar (não só reagir depois do 429). Isso
// conserta todo chamador de uma vez (sync/incremental, sync/all, debrief, car-comparison, etc.), não
// só um lugar.
const LOW_CAPACITY_THRESHOLD = 2; // headers docs: "can use the last available capacity and return 0" -- pausa perto do fim, não só no zero
const MAX_RETRIES = 2; // até 3 tentativas no total; rotas de sync têm maxDuration=300s de sobra para isso

export async function garage61Get<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  attempt = 0
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await response.text();

  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  const retryAfterHeaderSeconds = Number(response.headers.get("retry-after"));
  const globalRemaining = Number(response.headers.get("x-ratelimit-global-remaining"));
  const bucketRemaining = Number(response.headers.get("x-ratelimit-bucket-remaining"));

  if (!response.ok) {
    // Docs: "Wait for Retry-After, plus a small amount of random jitter. Do not retry immediately or
    // send several parallel retries." A couple of bounded, backed-off retries respect that without
    // turning a sync into an unbounded job.
    if (response.status === 429 && attempt < MAX_RETRIES) {
      const parsed = typeof data === "object" && data ? data as { details?: { retryAfterSeconds?: unknown } } : null;
      const bodyDelay = Number(parsed?.details?.retryAfterSeconds);
      const delaySeconds = Math.min(90, Math.max(1, Number.isFinite(retryAfterHeaderSeconds) ? retryAfterHeaderSeconds : Number.isFinite(bodyDelay) ? bodyDelay : 15));
      const jitterMs = Math.random() * 750;
      await sleep(delaySeconds * 1000 + jitterMs);
      return garage61Get<T>(path, params, attempt + 1);
    }
    throw new Error(
      `Garage61 API ${response.status}: ${JSON.stringify(data)}`
    );
  }

  // Proactive pacing on a SUCCESSFUL response, per Garage61's own recommendation: "On a successful
  // response, use Retry-After to pause requests for the same operation, application and user before
  // a limit is exceeded." Without this, a tight loop of many successful calls (sync/incremental
  // pagination across many car/track pairs) drains the burst allowance silently and only finds out
  // once the NEXT call 429s -- pausing here, while capacity is still visibly low, is what actually
  // keeps a multi-request job under the ceiling instead of just reacting after the fact.
  const lowCapacity = (Number.isFinite(globalRemaining) && globalRemaining <= LOW_CAPACITY_THRESHOLD)
    || (Number.isFinite(bucketRemaining) && bucketRemaining <= LOW_CAPACITY_THRESHOLD);
  if (lowCapacity && Number.isFinite(retryAfterHeaderSeconds) && retryAfterHeaderSeconds > 0) {
    await sleep(Math.min(30, retryAfterHeaderSeconds) * 1000 + Math.random() * 400);
  }

  return data as T;
}
