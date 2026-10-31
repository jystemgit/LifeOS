import { redirect } from "next/navigation";
import { requireOwnerId } from "@/lib/require-owner";
export const instant = false;
export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwnerId();
  redirect(`/tasks?task=${encodeURIComponent((await params).id)}`);
}
