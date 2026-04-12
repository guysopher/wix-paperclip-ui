# Scripts

Utility scripts for the Wix AI Business Manager backoffice.

## add-run-summary-to-agents.js

Adds the RUN_SUMMARY instruction to all existing agents that don't already have it.

**Usage:**

1. Find your company ID (from the URL when viewing your company, or from the database)
2. Run the script:

```bash
node scripts/add-run-summary-to-agents.js <companyId>
```

**Example:**

```bash
node scripts/add-run-summary-to-agents.js cm123abc456
```

**What it does:**

- Fetches all agents for the specified company
- Checks if each agent already has RUN_SUMMARY in their prompt
- If not, appends the RUN_SUMMARY instruction to their prompt template
- Updates the agent via the Paperclip API

**Output:**

```
Fetching agents for company cm123abc456...
Found 5 agents
  ✓ CEO already has RUN_SUMMARY instruction
  → Updating Skills Engineer...
  ✓ Updated Skills Engineer
  → Updating Evaluator...
  ✓ Updated Evaluator
  → Updating Prompt Engineer...
  ✓ Updated Prompt Engineer

Done! Updated 3 agents, skipped 2 agents
```

**Environment:**

Set `PAPERCLIP_API_URL` if your Paperclip API is not at `http://localhost:3100/api`:

```bash
PAPERCLIP_API_URL=https://your-api.com node scripts/add-run-summary-to-agents.js cm123abc456
```
