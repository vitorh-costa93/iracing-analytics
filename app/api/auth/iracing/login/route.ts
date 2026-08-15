import { NextResponse } from "next/server";
import { authorize } from "@/lib/iracing";
import {
  challenge,
  random,
  seal,
  PENDING,
} from "@/lib/oauth";

export async function GET() {
  const state = random();
  const verifier = random();

  const authorizationUrl = authorize(
    state,
    challenge(verifier)
  );

  const response = NextResponse.redirect(authorizationUrl);

  response.cookies.set(
    PENDING,
    seal({ state, verifier }),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    }
  );

  return response;
}
