import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const eventId =
      request.nextUrl.searchParams.get("event");

    if (!eventId) {
      return NextResponse.json(
        {
          status: "error",
          message: "Informe ?event=EVENT_ID",
        },
        { status: 400 }
      );
    }

    const token =
      process.env.GARAGE61_API_TOKEN;

    if (!token) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "GARAGE61_API_TOKEN não configurado",
        },
        { status: 500 }
      );
    }

    const url =
      `https://garage61.net/api/internal/events_live_timing/${encodeURIComponent(
        eventId
      )}/state`;

    const response =
      await fetch(url, {
        method: "GET",

        headers: {
          Authorization:
            `Bearer ${token}`,

          Accept:
            "application/vnd.google.protobuf",
        },

        cache: "no-store",
      });

    const contentType =
      response.headers.get(
        "content-type"
      );

    const eventLive =
      response.headers.get(
        "X-G61-Event-Live"
      );

    const buffer =
      await response.arrayBuffer();

    const bytes =
      new Uint8Array(buffer);

    // Só para diagnóstico:
    // mostramos os primeiros bytes em hexadecimal.
    const preview =
      Array.from(
        bytes.slice(0, 80)
      )
        .map((byte) =>
          byte
            .toString(16)
            .padStart(2, "0")
        )
        .join(" ");

    return NextResponse.json({
      status:
        response.ok
          ? "ok"
          : "error",

      httpStatus:
        response.status,

      contentType,

      eventLive,

      byteLength:
        bytes.length,

      hexPreview:
        preview,
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
      {
        status: 500,
      }
    );
  }
}
