import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireOwnerId } from "@/lib/require-owner";
import { googleConfig, GOOGLE_SCOPES } from "@/lib/google-calendar";
import { sealIntegration } from "@/lib/integration-tokens";

export async function GET() {
  const userId = await requireOwnerId(), config = googleConfig();
  const state = randomBytes(32).toString("base64url"), verifier = randomBytes(48).toString("base64url");
  (await cookies()).set("lifeos-google-oauth", sealIntegration("google", JSON.stringify({ userId, state, verifier, expiresAt: Date.now() + 600000 })), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/integrations/google",
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: config.clientId, response_type: "code", redirect_uri: config.redirectUri, scope: GOOGLE_SCOPES,
    state, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    access_type: "offline", prompt: "consent" }).toString();
  return Response.redirect(url, 302);
}
