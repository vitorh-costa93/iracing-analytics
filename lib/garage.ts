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
  params?: Record<string, string | number | undefined>
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
    throw new Error(
      `Garage61 API ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data as T;
}
