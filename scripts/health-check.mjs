const baseUrl =
  process.env.HEALTH_BASE_URL ||
  process.env.APP_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";

const url = new URL("/api/health", baseUrl);
const companyId = process.env.HEALTH_COMPANY_ID;

try {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(companyId ? { companyId } : {}),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    console.error(`Health check failed: ${response.status} ${response.statusText}`);
    if (data) {
      console.error(JSON.stringify(data, null, 2));
    }
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));

  if (data?.status === "error") {
    process.exit(1);
  }
} catch (error) {
  console.error(
    `Failed to reach ${url.toString()}: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
