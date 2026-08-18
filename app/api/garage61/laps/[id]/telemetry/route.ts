import { NextRequest, NextResponse } from "next/server";

const BASE_URL = "https://garage61.net/api/v1";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const token = process.env.GARAGE61_API_TOKEN;

    if (!token) {
      return NextResponse.json(
        {
          status: "error",
          message: "GARAGE61_API_TOKEN não configurado",
        },
        { status: 500 }
      );
    }

    const response = await fetch(
      `${BASE_URL}/laps/${encodeURIComponent(id)}/csv`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "text/csv",
        },
        cache: "no-store",
      }
    );

    const data = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        {
          status: "error",
          httpStatus: response.status,
          message: data,
        },
        { status: response.status }
      );
    }

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
      },
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
