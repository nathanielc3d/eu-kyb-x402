import test from "node:test";
import assert from "node:assert/strict";
import { unb64, b64, mockFetch } from "./helpers.js";
import worker, { NETWORKS } from "../src/worker.js";

const PAY_TO = "0x40f100ccCF51EEA928a3f314fB6ab63Bf8fa51F3";
const call = (path, headers = {}) => worker.fetch(new Request("https://x.test" + path, { headers }), {}, { waitUntil() {} });
const ok = { isValid: true, payer: "0xabc" };
const settled = (net) => ({ success: true, transaction: "0xtx", network: net, payer: "0xabc" });

test("C1 402 lists Base first, then Avalanche, Polygon, Celo (v2 header and v1 body)", async () => {
  const r = await call("/v1/iban");
  assert.equal(r.status, 402);
  const v2 = unb64(r.headers.get("PAYMENT-REQUIRED"));
  assert.deepEqual(v2.accepts.map((a) => a.network), ["eip155:8453", "eip155:43114", "eip155:137", "eip155:42220"]);
  for (const a of v2.accepts) { assert.equal(a.payTo, PAY_TO); assert.equal(a.amount, "3000"); assert.equal(a.scheme, "exact"); assert.equal(a.extra.version, "2"); }
  assert.equal(v2.accepts[0].asset, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(v2.accepts[1].asset, "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E");
  assert.equal(v2.accepts[3].extra.name, "USDC");
  const v1 = await r.json();
  assert.deepEqual(v1.accepts.map((a) => a.network), ["base", "avalanche", "polygon", "celo"]);
  assert.ok(r.headers.get("PAYMENT-REQUIRED").length < 7000, "header stays well under 8 KB");
});

for (const n of NETWORKS) {
  test(`C1 v2 payment on ${n.v2} is verified and settled by ${n.facilitator}`, async (t) => {
    const calls = mockFetch(t, { [n.facilitator + "/verify"]: () => ok, [n.facilitator + "/settle"]: () => settled(n.v2) });
    const payload = { x402Version: 2, accepted: { scheme: "exact", network: n.v2, asset: n.asset, payTo: PAY_TO, amount: "3000", maxTimeoutSeconds: 120, extra: n.extra }, payload: {} };
    const r = await call("/v1/iban?iban=DE89370400440532013000", { "PAYMENT-SIGNATURE": b64(payload) });
    assert.equal(r.status, 200);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((c) => c.url.startsWith(n.facilitator)));
    const sent = JSON.parse(calls[0].body);
    assert.equal(sent.paymentRequirements.network, n.v2);
    assert.equal(sent.paymentRequirements.asset, n.asset);
    assert.equal(unb64(r.headers.get("PAYMENT-RESPONSE")).network, n.v2);
    assert.equal((await r.json())._meta.network, n.v2);
  });
  test(`C1 v1 payment on "${n.v1}" goes to ${n.facilitator}`, async (t) => {
    const calls = mockFetch(t, { [n.facilitator + "/verify"]: () => ok, [n.facilitator + "/settle"]: () => settled(n.v1) });
    const r = await call("/v1/iban?iban=DE89370400440532013000", { "X-PAYMENT": b64({ x402Version: 1, scheme: "exact", network: n.v1, payload: {} }) });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(calls[0].body).paymentRequirements.asset, n.asset);
  });
}

test("C1 wrong asset for the chosen network or unknown network -> 402, facilitator never called", async (t) => {
  const calls = mockFetch(t, {});
  const base = { scheme: "exact", payTo: PAY_TO, amount: "3000" };
  let r = await call("/v1/iban?iban=DE89370400440532013000", { "PAYMENT-SIGNATURE": b64({ x402Version: 2, accepted: { ...base, network: "eip155:43114", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, payload: {} }) });
  assert.equal(r.status, 402);
  r = await call("/v1/iban?iban=DE89370400440532013000", { "PAYMENT-SIGNATURE": b64({ x402Version: 2, accepted: { ...base, network: "eip155:1", asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }, payload: {} }) });
  assert.equal(r.status, 402);
  assert.match(unb64(r.headers.get("PAYMENT-REQUIRED")).error, /unsupported network/);
  r = await call("/v1/iban?iban=DE89370400440532013000", { "X-PAYMENT": b64({ x402Version: 1, scheme: "exact", network: "ethereum", payload: {} }) });
  assert.equal(r.status, 402);
  assert.equal(calls.length, 0);
});

test("C1 discovery docs mention every network", async () => {
  const llms = await (await call("/llms.txt")).text();
  const oa = await (await call("/openapi.json")).json();
  const wk = await (await call("/.well-known/x402")).json();
  for (const n of NETWORKS) {
    assert.ok(llms.includes(n.v2) && llms.includes(n.asset));
    assert.ok(oa.paths["/v1/iban"].get["x-payment-info"]["x-networks"].some((x) => x.network === n.v2));
    assert.ok(wk.items[0].accepts.some((a) => a.network === n.v2));
  }
});
