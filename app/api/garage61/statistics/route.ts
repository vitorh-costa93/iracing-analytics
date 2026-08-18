import { NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";

export async function GET() {
  try {
    const data = await garage61Get<unknown>("/me/statistics");

    return NextResponse.json({
      status: "ok",

      diagnostics: {
        isArray: Array.isArray(data),

        type: typeof data,

        keys:
          data && typeof data === "object"
            ? Object.keys(data)
            : [],

        preview: data,
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
