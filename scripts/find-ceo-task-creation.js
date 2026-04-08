/**
 * Find CEO runs where tasks were created and inspect the calls
 *
 * Usage: node scripts/find-ceo-task-creation.js <companyId>
 */

const PAPERCLIP_API = process.env.PAPERCLIP_API_URL || "http://localhost:3100/api";

async function findTaskCreation(companyId) {
  console.log(`Searching for CEO task creation runs...`);

  // Fetch CEO
  const agentsRes = await fetch(`${PAPERCLIP_API}/companies/${companyId}/agents`);
  const agents = await agentsRes.json();
  const ceo = agents.find((a) => a.role === "ceo");

  if (!ceo) {
    console.log("No CEO found");
    return;
  }

  // Fetch all CEO runs
  const runsRes = await fetch(`${PAPERCLIP_API}/companies/${companyId}/heartbeat-runs`);
  const runs = await runsRes.json();
  const ceoRuns = runs
    .filter((r) => r.agentId === ceo.id && r.status === "succeeded")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10); // Check last 10 runs

  console.log(`Checking ${ceoRuns.length} recent CEO runs...\n`);

  for (const run of ceoRuns) {
    try {
      const logRes = await fetch(`${PAPERCLIP_API}/heartbeat-runs/${run.id}/log`);
      if (!logRes.ok) continue;

      const log = await logRes.json();
      const logText = typeof log === "string" ? log : (log.content || log.log || log.output || "");

      // Look for tool calls to create issues
      const toolCallMatches = logText.match(/<tool_use>[\s\S]*?<\/tool_use>/g);

      if (toolCallMatches) {
        const createIssueCalls = toolCallMatches.filter(tc => tc.includes('createIssue') || tc.includes('/issues'));

        if (createIssueCalls.length > 0) {
          console.log(`\n${"=".repeat(80)}`);
          console.log(`FOUND IN RUN: ${run.id}`);
          console.log(`Created: ${run.createdAt}`);
          console.log(`${"=".repeat(80)}`);

          createIssueCalls.forEach((call, i) => {
            console.log(`\n[Task Creation ${i + 1}]:`);
            // Extract the parameters section
            const paramsMatch = call.match(/<parameters>([\s\S]*?)<\/parameters>/);
            if (paramsMatch) {
              console.log(paramsMatch[1].trim());
            } else {
              console.log(call.substring(0, 500));
            }
          });

          // Only show first match
          break;
        }
      }
    } catch (e) {
      // Skip this run
    }
  }
}

// Main
const companyId = process.argv[2];
if (!companyId) {
  console.error("Usage: node scripts/find-ceo-task-creation.js <companyId>");
  process.exit(1);
}

findTaskCreation(companyId)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
