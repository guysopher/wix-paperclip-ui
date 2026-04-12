import { redirect } from "next/navigation";
import { withMsid } from "@/lib/msid";

export default async function ChatRedirect({
  searchParams,
}: {
  searchParams: Promise<{ msid?: string }>;
}) {
  const { msid } = await searchParams;
  redirect(withMsid("/", msid));
}
