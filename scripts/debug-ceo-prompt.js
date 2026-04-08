/**
 * Debug script to check CEO prompt and recent task creation
 *
 * Usage: node scripts/debug-ceo-prompt.js <companyId>
 */

const PAPERCLIP_API = process.env.PAPERCLIP_API_URL || "http://localhost:3100/api";

async function debugCEO(companyId) {
  console.log(`Fetching agents for company ${companyId}...`);

  // Fetch all agents
  const agentsRes = await fetch(`${PAPERCLIP_API}/companies/${companyId}/agents`);
  if (!agentsRes.ok) {
    throw new Error(`Failed to fetch agents: ${agentsRes.statusText}`);
  }
  const agents = await agentsRes.json();

  // Find CEO
  const ceo = agents.find((a) => a.role === "ceo");
  if (!ceo) {
    console.log("No CEO found");
    return;
  }

  console.log(`\nCEO: ${ceo.name} (${ceo.id})`);
  console.log("\n" + "=".repeat(80));
  console.log("CEO PROMPT EXCERPT (first 2000 chars):");
  console.log("=".repeat(80));
  const prompt = ceo.adapterConfig?.promptTemplate || "";
  console.log(prompt.substring(0, 2000));
  console.log("\n...\n");

  // Check for key phrases
  console.log("=".repeat(80));
  console.log("PROMPT ANALYSIS:");
  console.log("=".repeat(80));
  console.log("Contains 'TASK ASSIGNMENT RULES':", prompt.includes("TASK ASSIGNMENT RULES"));
  console.log("Contains 'assigneeAgentId':", prompt.includes("assigneeAgentId"));
  console.log("Contains 'assigneeUserId':", prompt.includes("assigneeUserId"));

  // Fetch recent tasks
  console.log("\n" + "=".repeat(80));
  console.log("RECENT TASKS (last 5):");
  console.log("=".repeat(80));

  const issuesRes = await fetch(`${PAPERCLIP_API}/companies/${companyId}/issues`);
  if (issuesRes.ok) {
    const issues = await issuesRes.json();
    const recent = issues
      .filter((i) => i.title !== "Board Inbox")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    recent.forEach((issue) => {
      const agentName = agents.find((a) => a.id === (issue.assigneeAgentId || issue.assigneeId))?.name || "UNASSIGNED";
      console.log(`\n${issue.identifier}: ${issue.title}`);
      console.log(`  assigneeAgentId: ${issue.assigneeAgentId || "null"}`);
      console.log(`  assigneeId: ${issue.assigneeId || "null"}`);
      console.log(`  assigneeUserId: ${issue.assigneeUserId || "null"}`);
      console.log(`  → ${agentName}`);
    });
  }

  // Fetch recent CEO run
  console.log("\n" + "=".repeat(80));
  console.log("RECENT CEO RUN:");
  console.log("=".repeat(80));

  const runsRes = await fetch(`${PAPERCLIP_API}/companies/${companyId}/heartbeat-runs`);
  if (runsRes.ok) {
    const runs = await runsRes.json();
    const ceoRuns = runs
      .filter((r) => r.agentId === ceo.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (ceoRuns.length > 0) {
      const latestRun = ceoRuns[0];
      console.log(`Run ID: ${latestRun.id}`);
      console.log(`Status: ${latestRun.status}`);
      console.log(`Created: ${latestRun.createdAt}`);

      // Try to fetch log to see task creation
      try {
        const logRes = await fetch(`${PAPERCLIP_API}/heartbeat-runs/${latestRun.id}/log`);
        if (logRes.ok) {
          const log = await logRes.json();
          const logText = typeof log === "string" ? log : (log.content || log.log || log.output || "");

          // Look for createIssue calls
          const createIssueMatches = logText.match(/createIssue[^}]*\{[^}]+\}/g);
          if (createIssueMatches) {
            console.log("\nTask creation calls found:");
            createIssueMatches.forEach((match, i) => {
              console.log(`\n[${i + 1}] ${match.substring(0, 200)}`);
            });
          } else {
            console.log("\nNo createIssue calls found in log");
          }
        }
      } catch (e) {
        console.log("Could not fetch run log:", e.message);
      }
    }
  }
}

// Main
const companyId = process.argv[2];
if (!companyId) {
  console.error("Usage: node scripts/debug-ceo-prompt.js <companyId>");
  process.exit(1);
}

debugCEO(companyId)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
