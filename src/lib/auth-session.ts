import "server-only";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getAuth } from "@/lib/auth";

export async function getAuthSession() {
  await connection();
  return getAuth().api.getSession({
    headers: await headers(),
  });
}
