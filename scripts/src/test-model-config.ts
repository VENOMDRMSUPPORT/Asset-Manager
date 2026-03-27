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

const originalZaiKey = process.env["ZAI_API_KEY"];
const originalReplitKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
const originalReplitURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];

const { getModelProvider, resetModelProvider } = await import("../../artifacts/api-server/src/lib/modelAdapter.js");

// Test 1: Throws a clear error when NO provider is configured at all
resetModelProvider();
delete process.env["ZAI_API_KEY"];
delete process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
delete process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];

try {
  getModelProvider();
  console.error("  ✗ FAIL: Should have thrown when no provider is configured");
  failed++;
} catch (err) {
  const msg = String(err);
  const hasKeyword = /api.key|provider|zai_api_key|no.*configured/i.test(msg);
  if (hasKeyword) {
    console.log("  ✓ Throws clear error when no provider is configured");
    passed++;
  } else {
    console.error(`  ✗ FAIL: Error message not descriptive enough: "${msg}"`);
    failed++;
  }
}

// Test 2: Initializes correctly with Replit AI integration env vars
resetModelProvider();
process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] = "replit-fake-key";
process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"] = "https://ai-integrations.example.com/v1";

try {
  const provider = getModelProvider();
  assert(typeof provider.chat === "function", "Provider has chat() method (Replit integration)");
  assert(typeof provider.chatStream === "function", "Provider has chatStream() method (Replit integration)");
} catch (err) {
  console.error(`  ✗ FAIL: Replit integration provider creation failed: ${String(err)}`);
  failed += 2;
}

// Test 3: Falls back to ZAI when Replit integration is absent
resetModelProvider();
delete process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
delete process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
process.env["ZAI_API_KEY"] = "test-fake-zai-key";
process.env["ZAI_BASE_URL"] = "https://api.z.ai/v1";
process.env["ZAI_MODEL"] = "z1-32b";

try {
  const provider = getModelProvider();
  assert(typeof provider.chat === "function", "Falls back to ZAI provider correctly");
} catch (err) {
  console.error(`  ✗ FAIL: ZAI fallback failed: ${String(err)}`);
  failed++;
}

// Test 4: Accepts custom ZAI_MODEL value
resetModelProvider();
process.env["ZAI_MODEL"] = "custom-model";

try {
  const provider = getModelProvider();
  assert(provider !== null, "Accepts custom ZAI_MODEL value");
} catch (err) {
  console.error(`  ✗ FAIL: Should accept custom model: ${String(err)}`);
  failed++;
}

// Restore env
if (originalZaiKey) process.env["ZAI_API_KEY"] = originalZaiKey;
else delete process.env["ZAI_API_KEY"];

if (originalReplitKey) process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] = originalReplitKey;
else delete process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

if (originalReplitURL) process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"] = originalReplitURL;
else delete process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];

resetModelProvider();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
