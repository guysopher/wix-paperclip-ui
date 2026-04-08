/**
 * Script to assign unassigned tasks to appropriate agents
 *
 * Usage: node scripts/assign-unassigned-tasks.js <companyId>
 */

const PAPERCLIP_API = process.env.PAPERCLIP_API_URL || "http://localhost:3100/api";

async function assignTasks(companyId) {
  console.log("Fetching agents and tasks...");

  // Fetch agents
  const agentsRes = await fetch(`${PAPERCLIP_API}/companies/${companyId}/agents`);
  const agents = await agentsRes.json();

  const ceo = agents.find((a) => a.role === "ceo");
  const evaluator = agents.find((a) => a.role === "qa");
  const promptEngineer = agents.find((a) => a.role === "designer");
  const skillsEngineer = agents.find((a) => a.role === "engineer");

  console.log(`\nAgents:`);
  console.log(`  CEO: ${ceo?.name} (${ceo?.id})`);
  console.log(`  Evaluator: ${evaluator?.name} (${evaluator?.id})`);
  console.log(`  Prompt Engineer: ${promptEngineer?.name} (${promptEngineer?.id})`);
  console.log(`  Skills Engineer: ${skillsEngineer?.name} (${skillsEngineer?.id})`);

  // Fetch tasks
  const issuesRes = await fetch(`${PAPERCLIP_API}/companies/${companyId}/issues`);
  const issues = await issuesRes.json();

  const unassignedTasks = issues.filter(
    (i) => !i.assigneeAgentId && !i.assigneeId && i.title !== "Board Inbox"
  );

  console.log(`\nFound ${unassignedTasks.length} unassigned tasks\n`);

  let updated = 0;

  for (const task of unassignedTasks) {
    // Determine assignee based on task content
    let assigneeId = null;
    let assigneeName = "";

    const title = task.title.toLowerCase();
    const description = (task.description || "").toLowerCase();

    if (title.includes("skills") || title.includes("tooling") || description.includes("skills")) {
      assigneeId = skillsEngineer?.id;
      assigneeName = skillsEngineer?.name;
    } else if (title.includes("prompt") || title.includes("audit prompts") || description.includes("prompt")) {
      assigneeId = promptEngineer?.id;
      assigneeName = promptEngineer?.name;
    } else if (
      title.includes("evaluate") ||
      title.includes("validation") ||
      title.includes("validate") ||
      title.includes("test") ||
      description.includes("evaluate")
    ) {
      assigneeId = evaluator?.id;
      assigneeName = evaluator?.name;
    } else if (title.includes("promote") || title.includes("urgent")) {
      assigneeId = ceo?.id;
      assigneeName = ceo?.name;
    } else {
      // Default to CEO for unclear tasks
      assigneeId = ceo?.id;
      assigneeName = ceo?.name;
    }

    if (!assigneeId) {
      console.log(`  ⊘ ${task.identifier}: No suitable agent found, skipping`);
      continue;
    }

    console.log(`  → ${task.identifier}: "${task.title.substring(0, 60)}..." → ${assigneeName}`);

    try {
      const updateRes = await fetch(`${PAPERCLIP_API}/issues/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigneeAgentId: assigneeId,
        }),
      });

      if (!updateRes.ok) {
        console.log(`     ✗ Failed: ${updateRes.statusText}`);
        continue;
      }

      console.log(`     ✓ Assigned`);
      updated++;
    } catch (e) {
      console.log(`     ✗ Error: ${e.message}`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`✨ Complete! Assigned ${updated} tasks`);
  console.log(`${"=".repeat(60)}`);
}

// Main
const companyId = process.argv[2];
if (!companyId) {
  console.error("Usage: node scripts/assign-unassigned-tasks.js <companyId>");
  process.exit(1);
}

assignTasks(companyId)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
