/**
 * Migration script to add assigneeAgentId instructions to all CEO agents
 *
 * Usage: node scripts/fix-ceo-assignee-field.js
 */

const PAPERCLIP_API = process.env.PAPERCLIP_API_URL || "http://localhost:3100/api";

const TASK_ASSIGNMENT_INSTRUCTION = `
TASK ASSIGNMENT RULES:
- When assigning to an agent (team member), use field: assigneeAgentId
- When assigning to the board (human), use field: assigneeUserId with value "local-board"
- NEVER create a task without an assignee — every task must have an owner`;

async function updateAllCEOs() {
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

    // Find CEO
    const ceo = agents.find((a) => a.role === "ceo");
    if (!ceo) {
      console.log(`   ⊘ No CEO found, skipping`);
      totalSkipped++;
      continue;
    }

    const promptTemplate = ceo.adapterConfig?.promptTemplate || "";

    // Check if already has the instruction
    if (promptTemplate.includes("TASK ASSIGNMENT RULES") || promptTemplate.includes("assigneeAgentId")) {
      console.log(`     ✓ ${ceo.name} already has task assignment instructions`);
      totalSkipped++;
      continue;
    }

    // Find the best place to insert (after "YOUR MISSION" or at the beginning)
    let updatedPrompt;
    const missionIndex = promptTemplate.indexOf("YOUR MISSION:");
    if (missionIndex !== -1) {
      // Find the end of the YOUR MISSION paragraph (next blank line or section)
      const afterMission = promptTemplate.substring(missionIndex);
      const nextSection = afterMission.search(/\n\n[A-Z]/);
      if (nextSection !== -1) {
        const insertPoint = missionIndex + nextSection;
        updatedPrompt =
          promptTemplate.substring(0, insertPoint) +
          "\n" + TASK_ASSIGNMENT_INSTRUCTION + "\n" +
          promptTemplate.substring(insertPoint);
      } else {
        // Just add at the end of YOUR MISSION paragraph
        updatedPrompt = promptTemplate.replace(
          "YOUR MISSION:",
          `TASK ASSIGNMENT RULES:
- When assigning to an agent (team member), use field: assigneeAgentId
- When assigning to the board (human), use field: assigneeUserId with value "local-board"
- NEVER create a task without an assignee — every task must have an owner

YOUR MISSION:`
        );
      }
    } else {
      // Add at the beginning
      updatedPrompt = TASK_ASSIGNMENT_INSTRUCTION + "\n\n" + promptTemplate;
    }

    console.log(`     → Updating ${ceo.name}...`);

    const updateRes = await fetch(`${PAPERCLIP_API}/agents/${ceo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adapterConfig: {
          ...ceo.adapterConfig,
          promptTemplate: updatedPrompt,
        },
      }),
    });

    if (!updateRes.ok) {
      console.error(`     ✗ Failed to update ${ceo.name}: ${updateRes.statusText}`);
      continue;
    }

    console.log(`     ✓ Updated ${ceo.name}`);
    totalUpdated++;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`✨ Migration Complete!`);
  console.log(`   Companies processed: ${companies.length}`);
  console.log(`   CEOs updated: ${totalUpdated}`);
  console.log(`   Skipped: ${totalSkipped}`);
  console.log(`${"=".repeat(60)}`);
}

// Main
updateAllCEOs()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Error:", err);
    process.exit(1);
  });
