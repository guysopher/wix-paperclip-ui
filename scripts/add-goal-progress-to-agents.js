/**
 * Migration script to add goalProgress to RUN_SUMMARY for all agents
 * that have the old format without goalProgress.
 *
 * Usage: node scripts/add-goal-progress-to-agents.js
 */

const PAPERCLIP_API = process.env.PAPERCLIP_API_URL || "http://localhost:3100/api";

const OLD_PATTERN = /RUN_SUMMARY: \{[^}]*"description"[^}]*\}/;
const GOAL_PROGRESS_PATTERN = /"goalProgress":/;

const GOAL_PROGRESS_ADDITION = `, "goalProgress": [{"goalId": "<goal-id>", "progress": <0-100>, "comment": "<brief status update>"}]}
Example: RUN_SUMMARY: {"title": "Assigned content tasks to Marketing and SEO agents", "description": "Reviewed 4 open tasks and delegated 3 to the right owners. One task was blocked and escalated to the board.", "goalProgress": [{"goalId": "goal-abc123", "progress": 45, "comment": "Marketing tasks in progress, SEO audit complete"}]}
GOAL PROGRESS: After every run, assess each active company goal's progress (0-100%). Be realistic and specific about what's blocking or advancing each goal. Only include goals you're actively working on.`;

async function updateAllCompanies() {
  console.log("Fetching all companies...");

  // Fetch all companies
  const companiesRes = await fetch(`${PAPERCLIP_API}/companies`);
  if (!companiesRes.ok) {
    throw new Error(`Failed to fetch companies: ${companiesRes.statusText}`);
  }
  const companies = await companiesRes.json();

  console.log(`Found ${companies.length} companies\n`);

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalAgents = 0;

  for (const company of companies) {
    console.log(`\n📦 Company: ${company.name} (${company.id})`);
    console.log(`   Fetching agents...`);

    // Fetch all agents for this company
    const agentsRes = await fetch(`${PAPERCLIP_API}/companies/${company.id}/agents`);
    if (!agentsRes.ok) {
      console.error(`   ✗ Failed to fetch agents: ${agentsRes.statusText}`);
      continue;
    }
    const agents = await agentsRes.json();

    console.log(`   Found ${agents.length} agents`);
    totalAgents += agents.length;

    for (const agent of agents) {
      const promptTemplate = agent.adapterConfig?.promptTemplate || "";

      // Check if agent already has goalProgress in RUN_SUMMARY
      if (GOAL_PROGRESS_PATTERN.test(promptTemplate)) {
        console.log(`     ✓ ${agent.name} already has goalProgress`);
        totalSkipped++;
        continue;
      }

      // Check if agent has RUN_SUMMARY at all
      if (!OLD_PATTERN.test(promptTemplate)) {
        console.log(`     ⊘ ${agent.name} has no RUN_SUMMARY, skipping`);
        totalSkipped++;
        continue;
      }

      // Replace the old RUN_SUMMARY format with new format including goalProgress
      const updatedPrompt = promptTemplate.replace(
        /RUN_SUMMARY: \{[^}]*"description"[^}]*\}/,
        `RUN_SUMMARY: {"title": "<verb-first, max 10 words, name what you specifically worked on>", "description": "<1-2 sentences, what was done and the outcome>"${GOAL_PROGRESS_ADDITION}`
      );

      console.log(`     → Updating ${agent.name}...`);

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
        console.error(`     ✗ Failed to update ${agent.name}: ${updateRes.statusText}`);
        continue;
      }

      console.log(`     ✓ Updated ${agent.name}`);
      totalUpdated++;
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`✨ Migration Complete!`);
  console.log(`   Companies processed: ${companies.length}`);
  console.log(`   Total agents: ${totalAgents}`);
  console.log(`   Updated: ${totalUpdated}`);
  console.log(`   Skipped: ${totalSkipped}`);
  console.log(`${"=".repeat(60)}`);
}

// Main
updateAllCompanies()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Error:", err);
    process.exit(1);
  });
