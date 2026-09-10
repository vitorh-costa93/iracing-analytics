const BASE_URL = "https://garage61.net/api/v1";

function getToken() {
  const token = process.env.GARAGE61_API_TOKEN;

  if (!token) {
    throw new Error("GARAGE61_API_TOKEN não configurado");
  }

  return token;
}

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

  if (!response.ok) {
    // A single bounded retry respects Garage61's own cooldown without turning an incremental sync
    // into an unbounded job. The recent sync log contained repeated 429s; failing immediately
    // makes an otherwise healthy daily run look stale to the product surface.
    if (response.status === 429 && attempt === 0) {
      const parsed = typeof data === "object" && data ? data as { details?: { retryAfterSeconds?: unknown } } : null;
      const headerDelay = Number(response.headers.get("retry-after"));
      const bodyDelay = Number(parsed?.details?.retryAfterSeconds);
      const delaySeconds = Math.min(60, Math.max(1, Number.isFinite(headerDelay) ? headerDelay : Number.isFinite(bodyDelay) ? bodyDelay : 15));
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
      return garage61Get<T>(path, params, attempt + 1);
    }
    throw new Error(
      `Garage61 API ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data as T;
}
