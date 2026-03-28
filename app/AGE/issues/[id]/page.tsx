import { redirect } from "next/navigation";

export default async function IssueRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/tasks?issue=${id}`);
}
