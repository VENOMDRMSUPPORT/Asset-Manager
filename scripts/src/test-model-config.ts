import { execSync } from "child_process";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

console.log("\n=== Model Config Tests ===\n");

const originalKey = process.env["ZAI_API_KEY"];
delete process.env["ZAI_API_KEY"];

const { getModelProvider, resetModelProvider } = await import("../../artifacts/api-server/src/lib/modelAdapter.js");

resetModelProvider();

try {
  getModelProvider();
  console.error("  ✗ FAIL: Should have thrown without ZAI_API_KEY");
  failed++;
} catch (err) {
  const msg = String(err);
  if (msg.toLowerCase().includes("zai_api_key") || msg.toLowerCase().includes("api_key") || msg.toLowerCase().includes("environment variable")) {
    console.log("  ✓ Throws clear error when ZAI_API_KEY is missing");
    passed++;
  } else {
    console.error(`  ✗ FAIL: Error message not descriptive enough: "${msg}"`);
    failed++;
  }
}

resetModelProvider();
process.env["ZAI_API_KEY"] = "test-fake-key-for-validation";
process.env["ZAI_BASE_URL"] = "https://api.z.ai/v1";
process.env["ZAI_MODEL"] = "z1-32b";

try {
  const provider = getModelProvider();
  assert(typeof provider.chat === "function", "Provider has chat() method");
  assert(typeof provider.chatStream === "function", "Provider has chatStream() method");
} catch (err) {
  console.error(`  ✗ FAIL: Provider creation failed: ${String(err)}`);
  failed++;
}

resetModelProvider();
process.env["ZAI_MODEL"] = "custom-model";

try {
  const provider = getModelProvider();
  assert(provider !== null, "Accepts custom ZAI_MODEL value");
} catch (err) {
  console.error(`  ✗ FAIL: Should accept custom model: ${String(err)}`);
  failed++;
}

if (originalKey) process.env["ZAI_API_KEY"] = originalKey;
else delete process.env["ZAI_API_KEY"];

resetModelProvider();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
