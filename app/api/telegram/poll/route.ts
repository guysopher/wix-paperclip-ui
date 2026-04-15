export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    skipped: "Telegram now uses webhook-driven replies with per-user company sessions.",
  });
}
