import { NextResponse } from "next/server";

const SITE_URL = "https://creovanta-omega.vercel.app";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json(
    {
      client_id: SITE_URL + "/.well-known/oauth-cimd",
      client_name: "Creovanta Voice Cloning",
      redirect_uris: [SITE_URL + "/"],
      token_endpoint_auth_method: "none",
      client_uri: SITE_URL,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
        "Content-Type": "application/json",
      },
    }
  );
}
