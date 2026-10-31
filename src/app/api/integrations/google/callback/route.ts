import { cookies } from "next/headers";
import { z } from "zod";
import { requireOwnerId } from "@/lib/require-owner";
import { getPrisma } from "@/lib/prisma";
import { exchangeGoogle, googleSubject } from "@/lib/google-calendar";
import { openIntegration, sealIntegration } from "@/lib/integration-tokens";

export async function GET(request: Request) {
  const userId = await requireOwnerId(), url = new URL(request.url);
  const cookie = (await cookies()).get("lifeos-google-oauth")?.value;
  (await cookies()).delete({ name: "lifeos-google-oauth", path: "/api/integrations/google" });
  try {
    if (!cookie) throw new Error("Missing Google OAuth state");
    const state = z.object({ userId: z.string(), state: z.string(), verifier: z.string(), expiresAt: z.number() }).parse(JSON.parse(openIntegration("google", cookie)));
    if (state.userId !== userId || state.state !== url.searchParams.get("state") || state.expiresAt < Date.now()) throw new Error("Invalid Google OAuth state");
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.has("error")) throw new Error("Google authorization denied");
    const tokens = await exchangeGoogle({ grant_type: "authorization_code", code, code_verifier: state.verifier });
    const subject = await googleSubject(tokens.access_token);
    const db = getPrisma(), existing = await db.googleCalendarConnection.findUnique({ where: { userId } });
    if (existing && existing.subject !== subject) throw new Error("Connect the original Google account");
    if (!tokens.refresh_token) throw new Error("Google did not return an offline refresh token");
    await db.googleCalendarConnection.upsert({ where: { userId },
      create: { userId, subject, refreshToken: sealIntegration("google", tokens.refresh_token) },
      update: { refreshToken: sealIntegration("google", tokens.refresh_token), error: null, lockedUntil: null } });
    return Response.redirect(new URL("/tasks", request.url), 303);
  } catch (error) {
    console.error("Google OAuth failed", error instanceof Error ? error.message : "Unknown OAuth failure");
    return Response.redirect(new URL(`/tasks?googleError=${encodeURIComponent("No se pudo autorizar Google Calendar Vuelve a conectar la cuenta original")}`, request.url), 303);
  }
}
