import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const eventId = request.nextUrl.searchParams.get("event");

    if (!eventId) {
      return NextResponse.json(
        {
          status: "error",
          message: "Informe ?event=EVENT_ID",
        },
        { status: 400 }
      );
    }

    const rawToken = process.env.GARAGE61_API_TOKEN;

    if (!rawToken) {
      return NextResponse.json(
        {
          status: "error",
          message: "GARAGE61_API_TOKEN não configurado",
        },
        { status: 500 }
      );
    }

    // Normalização defensiva
    const token = rawToken
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/^Bearer\s+/i, "");

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };

    // 1. Testar o mesmo token contra um endpoint público
    const publicResponse = await fetch(
      "https://garage61.net/api/v1/me",
      {
        headers,
        cache: "no-store",
      }
    );

    const publicText = await publicResponse.text();

    // 2. Testar contra o endpoint interno
    const internalResponse = await fetch(
      `https://garage61.net/api/internal/events_live_timing/${encodeURIComponent(
        eventId
      )}/state`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.google.protobuf",
        },
        cache: "no-store",
      }
    );

    const internalBuffer = await internalResponse.arrayBuffer();
    const internalBytes = new Uint8Array(internalBuffer);

    const internalPreview = new TextDecoder()
      .decode(internalBytes.slice(0, 500));

    return NextResponse.json({
      status: "ok",

      tokenDiagnostics: {
        rawLength: rawToken.length,
        normalizedLength: token.length,
        rawStartsWithBearer: /^Bearer\s+/i.test(rawToken.trim()),
        rawStartsWithQuote: /^["']/.test(rawToken.trim()),
        rawEndsWithQuote: /["']$/.test(rawToken.trim()),
        containsWhitespace: /\s/.test(token),
      },

      publicApi: {
        status: publicResponse.status,
        ok: publicResponse.ok,
        preview: publicText.slice(0, 300),
      },

      internalApi: {
        status: internalResponse.status,
        ok: internalResponse.ok,
        contentType: internalResponse.headers.get("content-type"),
        byteLength: internalBytes.length,
        preview: internalPreview,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 }
    );
  }
}
