/**
 * Real end-to-end test of the known-unknowns MCP server - not a mock.
 * Spawns the actual server as a subprocess (same way a real MCP client like
 * CrewAI or Claude Desktop would), connects to it over stdio, lists its
 * tools, and calls audit_confidence with a case designed to trigger a
 * warning - proving the full round-trip (spawn -> connect -> discover ->
 * call -> parse response) actually works, not just that the code compiles.
 *
 * audit_confidence is used here specifically because it's pure logic with
 * no LLM call inside it - so this test proves the MCP plumbing works
 * independently of whether the Anthropic API call inside graded_match also
 * works. Note the server still requires ANTHROPIC_API_KEY to be set to
 * start at all (it checks unconditionally at startup), even though this
 * particular tool doesn't use it.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=your_key_here
 *   npx tsx scripts/test-mcp-client.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  console.log("Spawning known-unknowns MCP server and connecting...\n");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcpServer.ts"],
    // MCP's stdio transport does NOT inherit the parent shell's environment
    // by default - this is a deliberate security choice (a spawned server
    // shouldn't automatically see every secret sitting in your shell), not
    // an oversight. It falls back to a minimal default env (PATH, HOME,
    // etc.) unless you explicitly forward what the server actually needs.
    env: { ...process.env } as Record<string, string>,
  });

  const client = new Client({ name: "known-unknowns-test-client", version: "0.1.0" });
  await client.connect(transport);

  console.log("Connected. Listing available tools...\n");
  const { tools } = await client.listTools();

  if (tools.length === 0) {
    console.error("FAIL: no tools were returned by the server.");
    process.exit(1);
  }

  for (const tool of tools as Array<{ name: string; description?: string }>) {
    console.log(`- ${tool.name}: ${tool.description?.slice(0, 80)}...`);
  }

  const expectedTools = ["graded_match", "audit_confidence"];
  const foundNames = tools.map((t) => t.name);
  const missing = expectedTools.filter((name) => !foundNames.includes(name));
  if (missing.length > 0) {
    console.error(`\nFAIL: expected tools not found: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("\nPASS: both expected tools are present.\n");

  console.log("Calling audit_confidence with a case designed to trigger a warning...\n");

  // Two candidates, both with evidenceType "descriptor" (no supporting
  // measurement), rated High and Low - the exact inconsistency pattern
  // auditConfidence exists to catch.
  const result = await client.callTool({
    name: "audit_confidence",
    arguments: {
      rankings: [
        {
          candidateId: "a",
          candidateTitle: "Candidate A",
          rank: 1,
          confidence: "High",
          evidenceType: "descriptor",
          reasoning: "Inferred from a style descriptor only, no measurement.",
        },
        {
          candidateId: "b",
          candidateTitle: "Candidate B",
          rank: 2,
          confidence: "Low",
          evidenceType: "descriptor",
          reasoning: "Also inferred from a style descriptor only, no measurement.",
        },
      ],
    },
  });

  const textContent = (result.content as Array<{ type: string; text?: string }>).find(
    (c) => c.type === "text"
  );

  if (!textContent || typeof textContent.text !== "string") {
    console.error("FAIL: no text content in tool result.");
    process.exit(1);
  }

  const parsed = JSON.parse((textContent as { text: string }).text);
  console.log("Raw result:");
  console.log(JSON.stringify(parsed, null, 2));

  if (!parsed.warnings || parsed.warnings.length === 0) {
    console.error(
      "\nFAIL: expected at least one audit warning for this inconsistent case, got none."
    );
    process.exit(1);
  }

  console.log(
    `\nPASS: got ${parsed.warnings.length} warning(s) as expected - the MCP round-trip works end to end.`
  );

  await client.close();
}

main().catch((err) => {
  console.error("Test client failed:", err);
  process.exit(1);
});