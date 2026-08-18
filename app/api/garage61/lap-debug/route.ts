// app/api/garage61/lap-debug/route.ts

import { NextRequest, NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        {
          status: "error",
          message: "Informe ?id=LAP_ID",
        },
        { status: 400 }
      );
    }

    const data = await garage61Get(
      `/laps/${encodeURIComponent(id)}`
    );

    return NextResponse.json({
      status: "ok",
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
