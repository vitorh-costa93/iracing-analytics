import { NextResponse } from "next/server";
import { authorize } from "@/lib/iracing";
import { challenge, random } from "@/lib/oauth";

export async function GET() {
  try {
    const state = random();
    const verifier = random();

    const authorizationUrl = authorize(
      state,
      challenge(verifier)
    );

    return NextResponse.json({
      status: "ok",
      authorizationUrl,
      hasClientId: Boolean(process.env.IRACING_CLIENT_ID),
      hasRedirectUri: Boolean(process.env.IRACING_REDIRECT_URI),
      hasClientSecret: Boolean(process.env.IRACING_CLIENT_SECRET),
      hasScope: Boolean(process.env.IRACING_SCOPE),
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
