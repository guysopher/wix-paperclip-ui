/**
 * Migration script to add RUN_SUMMARY instruction to all agents
 * across ALL companies.
 *
 * Usage: node scripts/add-run-summary-to-all-companies.js
 */

const PAPERCLIP_API = process.env.PAPERCLIP_API_URL || "http://localhost:3100/api";

const RUN_SUMMARY_INSTRUCTION = `\n\nAt the end of every run, the very last thing you output — no exceptions:
RUN_SUMMARY: {"title": "<verb-first, max 10 words, name what you specifically worked on>", "description": "<1-2 sentences, what was done and the outcome>"}
Example: RUN_SUMMARY: {"title": "Assigned content tasks to Marketing and SEO agents", "description": "Reviewed 4 open tasks and delegated 3 to the right owners. One task was blocked and escalated to the board."}
This line is read by the backoffice activity feed — be specific, not generic.`;

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

      // Check if agent already has RUN_SUMMARY instruction
      if (promptTemplate.includes("RUN_SUMMARY:")) {
        console.log(`     ✓ ${agent.name} already has RUN_SUMMARY`);
        totalSkipped++;
        continue;
      }

      // Add RUN_SUMMARY instruction to the prompt
      const updatedPrompt = promptTemplate + RUN_SUMMARY_INSTRUCTION;

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
