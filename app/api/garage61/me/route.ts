import { NextResponse } from "next/server";

export async function GET() {
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

  try {
    const response = await fetch("https://garage61.net/api/v1/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const text = await response.text();
    

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return NextResponse.json(
      {
        status: response.ok ? "ok" : "error",
        httpStatus: response.status,
        data,
      },
      { status: response.status }
    );
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
