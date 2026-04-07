/**
 * Migration script to add RUN_SUMMARY instruction to all existing agents
 * that don't already have it in their prompt templates.
 *
 * Usage: node scripts/add-run-summary-to-agents.js <companyId>
 */

const PAPERCLIP_API = process.env.PAPERCLIP_API_URL || "http://localhost:3100/api";

const RUN_SUMMARY_INSTRUCTION = `\n\nAt the end of every run, the very last thing you output — no exceptions:
RUN_SUMMARY: {"title": "<verb-first, max 10 words, name what you specifically worked on>", "description": "<1-2 sentences, what was done and the outcome>", "goalProgress": [{"goalId": "<goal-id>", "progress": <0-100>, "comment": "<brief status update>"}]}
Example: RUN_SUMMARY: {"title": "Assigned content tasks to Marketing and SEO agents", "description": "Reviewed 4 open tasks and delegated 3 to the right owners. One task was blocked and escalated to the board.", "goalProgress": [{"goalId": "goal-abc123", "progress": 45, "comment": "Marketing tasks in progress, SEO audit complete"}]}
GOAL PROGRESS: After every run, assess each active company goal's progress (0-100%). Be realistic and specific about what's blocking or advancing each goal. Only include goals you're actively working on.`;

async function updateAgents(companyId) {
  console.log(`Fetching agents for company ${companyId}...`);

  // Fetch all agents for the company
  const agentsRes = await fetch(`${PAPERCLIP_API}/companies/${companyId}/agents`);
  if (!agentsRes.ok) {
    throw new Error(`Failed to fetch agents: ${agentsRes.statusText}`);
  }
  const agents = await agentsRes.json();

  console.log(`Found ${agents.length} agents`);

  let updated = 0;
  let skipped = 0;

  for (const agent of agents) {
    const promptTemplate = agent.adapterConfig?.promptTemplate || "";

    // Check if agent already has RUN_SUMMARY instruction
    if (promptTemplate.includes("RUN_SUMMARY:")) {
      console.log(`  ✓ ${agent.name} already has RUN_SUMMARY instruction`);
      skipped++;
      continue;
    }

    // Add RUN_SUMMARY instruction to the prompt
    const updatedPrompt = promptTemplate + RUN_SUMMARY_INSTRUCTION;

    console.log(`  → Updating ${agent.name}...`);

    const updateRes = await fetch(`${PAPERCLIP_API}/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adapterConfig: {
          ...agent.adapterConfig,
          promptTemplate: updatedPrompt,
        },
      }),
    });

    if (!updateRes.ok) {
      console.error(`  ✗ Failed to update ${agent.name}: ${updateRes.statusText}`);
      continue;
    }

    console.log(`  ✓ Updated ${agent.name}`);
    updated++;
  }

  console.log(`\nDone! Updated ${updated} agents, skipped ${skipped} agents`);
}

// Main
const companyId = process.argv[2];
if (!companyId) {
  console.error("Usage: node scripts/add-run-summary-to-agents.js <companyId>");
  process.exit(1);
}

updateAgents(companyId)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
