import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireOwnerId } from "@/lib/require-owner";
import { microsoftConfig, sealMicrosoft, MICROSOFT_SCOPES } from "@/lib/microsoft-todo";

export async function GET() {
  const userId = await requireOwnerId();
  const config = microsoftConfig();
  const state = randomBytes(32).toString("base64url"), verifier = randomBytes(48).toString("base64url");
  (await cookies()).set("lifeos-microsoft-oauth", sealMicrosoft(JSON.stringify({ userId, state, verifier, expiresAt: Date.now() + 600000 })), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/integrations/microsoft", maxAge: 600,
  });
  const url = new URL(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({ client_id: config.clientId, response_type: "code", redirect_uri: config.redirectUri,
    scope: MICROSOFT_SCOPES, state, code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), prompt: "consent" }).toString();
  return Response.redirect(url, 302);
}
