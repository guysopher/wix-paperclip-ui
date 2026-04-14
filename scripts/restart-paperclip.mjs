const baseUrl =
  process.env.HEALTH_BASE_URL ||
  process.env.APP_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";

const url = new URL("/api/health/restart", baseUrl);

try {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    console.error(`Restart failed: ${response.status} ${response.statusText}`);
    if (data) {
      console.error(JSON.stringify(data, null, 2));
    }
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));
} catch (error) {
  console.error(
    `Failed to reach ${url.toString()}: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
