import { NextRequest, NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";

export async function GET(request: NextRequest) {
  try {
    const eventId =
      request.nextUrl.searchParams.get("event");

    if (!eventId) {
      return NextResponse.json(
        {
          status: "error",
          message: "Informe ?event=GARAGE61_EVENT_ID",
        },
        { status: 400 }
      );
    }

    const data = await garage61Get(
      "/laps",
      {
        events: eventId,
      }
    );

    return NextResponse.json({
      status: "ok",
      eventId,
      data,
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
