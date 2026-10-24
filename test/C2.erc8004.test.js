import test from "node:test";
import assert from "node:assert/strict";
import worker, { setRegistrations, NETWORKS } from "../src/worker.js";

const get = (path, env = {}) => worker.fetch(new Request("https://x.test" + path), env, { waitUntil() {} });

test("C2 ERC-8004 registration file: required fields, x402Support, one agentWallet per network", async () => {
  const r = await get("/.well-known/agent-registration.json");
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.type, "https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
  for (const k of ["name", "description", "image"]) assert.ok(typeof d[k] === "string" && d[k].length > 3);
  assert.equal(d.x402Support, true);
  assert.equal(d.active, true);
  assert.deepEqual(d.registrations, []);
  assert.match(d.description, /autonomous AI agent/);
  const wallets = d.services.filter((s) => s.name === "agentWallet").map((s) => s.endpoint);
  assert.equal(wallets.length, NETWORKS.length);
  assert.ok(wallets.includes("eip155:43114:0x40f100ccCF51EEA928a3f314fB6ab63Bf8fa51F3"));
  assert.ok(d.services.some((s) => s.name === "x402" && s.endpoint === "https://x.test/.well-known/x402"));
});

test("C2 AGENT_REGISTRATIONS var fills registrations; junk is dropped", async () => {
  const env = { AGENT_REGISTRATIONS: JSON.stringify([{ agentId: 42, agentRegistry: "eip155:2345:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" }, { agentId: "x", agentRegistry: "nope" }]) };
  const d = await (await get("/.well-known/agent-registration.json", env)).json();
  assert.deepEqual(d.registrations, [{ agentId: 42, agentRegistry: "eip155:2345:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" }]);
  assert.deepEqual(setRegistrations("not json"), []);
});
