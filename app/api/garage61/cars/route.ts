import { NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";

export async function GET() {
  try {
    const data = await garage61Get("/cars");

    return NextResponse.json({
      status: "ok",
      data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
