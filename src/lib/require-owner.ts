import "server-only";
import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth-session";

export async function requireOwnerId(): Promise<string> {
  const session = await getAuthSession();
  if (!session) {
    redirect("/sign-in");
  }
  if (session.user.twoFactorEnabled !== true) {
    redirect("/security");
  }
  return session.user.id;
}
