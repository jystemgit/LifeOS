import { cookies } from "next/headers";
import { z } from "zod";
import { requireOwnerId } from "@/lib/require-owner";
import { getPrisma } from "@/lib/prisma";
import { openMicrosoft, sealMicrosoft, exchangeMicrosoft, GraphClient, microsoftAccount, MICROSOFT_SCOPES } from "@/lib/microsoft-todo";

export async function GET(request: Request) {
  const userId = await requireOwnerId();
  const url = new URL(request.url);
  const saved = (await cookies()).get("lifeos-microsoft-oauth")?.value;
  (await cookies()).delete({ name: "lifeos-microsoft-oauth", path: "/api/integrations/microsoft" });
  try {
    if (!saved) throw new Error("Missing OAuth state");
    const state = z.object({ userId: z.string(), state: z.string(), verifier: z.string(), expiresAt: z.number() }).parse(JSON.parse(openMicrosoft(saved)));
    if (state.userId !== userId || state.state !== url.searchParams.get("state") || state.expiresAt < Date.now()) throw new Error("Invalid OAuth state");
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.has("error")) throw new Error("Microsoft authorization denied");
    const tokens = await exchangeMicrosoft({ grant_type: "authorization_code", code, code_verifier: state.verifier });
    if (!tokens.refresh_token) throw new Error("Microsoft did not return an offline refresh token");
    const accountId = await microsoftAccount(new GraphClient(tokens.access_token));
    const db = getPrisma();
    let existing = await db.microsoftConnection.findUnique({ where: { userId } });
    if (existing && !existing.accountId) {
      if (!existing.refreshToken) throw new Error("The original Microsoft account cannot be verified");
      const original = await exchangeMicrosoft({ grant_type: "refresh_token", refresh_token: openMicrosoft(existing.refreshToken), scope: MICROSOFT_SCOPES });
      const originalId = await microsoftAccount(new GraphClient(original.access_token));
      const refreshToken = original.refresh_token ? sealMicrosoft(original.refresh_token) : existing.refreshToken;
      const migrated = await db.microsoftConnection.updateMany({
        where: { userId, accountId: null, refreshToken: existing.refreshToken },
        data: { accountId: originalId, refreshToken, lockedUntil: null },
      });
      if (migrated.count !== 1) throw new Error("Microsoft connection changed during authorization");
      existing = { ...existing, accountId: originalId, refreshToken };
    }
    if (existing && existing.accountId !== accountId) throw new Error("Connect the original Microsoft account");
    const encrypted = sealMicrosoft(tokens.refresh_token);
    if (existing) {
      const updated = await db.microsoftConnection.updateMany({
        where: { userId, accountId, refreshToken: existing.refreshToken },
        data: { refreshToken: encrypted, error: null, lockedUntil: null },
      });
      if (updated.count !== 1) throw new Error("Microsoft connection changed during authorization");
    } else {
      if (await db.taskListSynchronizationRecord.count({ where: { userId } }) || await db.taskSynchronizationRecord.count({ where: { userId } }))
        throw new Error("Existing Microsoft mappings need original-account reconciliation before connecting");
      await db.microsoftConnection.create({ data: { userId, accountId, refreshToken: encrypted } });
    }
    return Response.redirect(new URL("/tasks", request.url), 303);
  } catch (error) {
    console.error("Microsoft OAuth authorization failed", error instanceof Error ? error.message : "Unknown OAuth error");
    return Response.redirect(new URL(`/tasks?microsoftError=${encodeURIComponent("No se pudo autorizar Microsoft To Do Vuelve a conectar la cuenta original")}`, request.url), 303);
  }
}
