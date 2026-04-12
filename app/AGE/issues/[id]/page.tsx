import { redirect } from "next/navigation";
import { withMsid } from "@/lib/msid";

export default async function IssueRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msid?: string }>;
}) {
  const { id } = await params;
  const { msid } = await searchParams;
  redirect(withMsid(`/tasks/${id}`, msid));
}
