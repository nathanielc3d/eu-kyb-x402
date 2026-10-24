import test from "node:test";
import assert from "node:assert/strict";
import { unb64, b64 } from "./helpers.js";
import worker, { setBuilderCode, builderCodeExtension, builderCodeEchoError } from "../src/worker.js";

const call = (env, headers = {}) => worker.fetch(new Request("https://x.test/v1/eu/vat?vat=FR39356000000", { headers }), env, { waitUntil() {} });

test("B1 no BUILDER_CODE: 402 does not advertise builder-code", async () => {
  const r = await call({});
  assert.equal(r.status, 402);
  assert.equal(unb64(r.headers.get("PAYMENT-REQUIRED")).extensions["builder-code"], undefined);
});

test("B1 invalid code is ignored", () => {
  assert.equal(setBuilderCode("BC-Bad!"), "");
  assert.equal(builderCodeExtension(), null);
});

test("B1 BUILDER_CODE set: 402 declares { info: { a } } with schema", async () => {
  const r = await call({ BUILDER_CODE: "bc_test1234" });
  const ext = unb64(r.headers.get("PAYMENT-REQUIRED")).extensions["builder-code"];
  assert.deepEqual(ext.info, { a: "bc_test1234" });
  assert.equal(ext.schema.properties.a.pattern, "^[a-z0-9_]{1,32}$");
  assert.ok(unb64(r.headers.get("PAYMENT-REQUIRED")).extensions.bazaar);
});

test("B1 echo validation: wrong a or too many s -> extension_echo_mismatch", async () => {
  setBuilderCode("bc_test1234");
  assert.equal(builderCodeEchoError({ extensions: { "builder-code": { a: "bc_test1234", s: "bc_client" } } }), null);
  assert.equal(builderCodeEchoError({ extensions: { "builder-code": { info: { a: "bc_test1234", s: ["bc_client"] }, schema: {} } } }), null);
  assert.match(builderCodeEchoError({ extensions: { "builder-code": { info: { a: "bc_nope" } } } }), /extension_echo_mismatch/);
  assert.match(builderCodeEchoError({ extensions: { "builder-code": { a: "bc_other" } } }), /extension_echo_mismatch/);
  assert.match(builderCodeEchoError({ extensions: { "builder-code": { s: Array(11).fill("bc_x") } } }), /extension_echo_mismatch/);
  const payload = { x402Version: 2, accepted: { scheme: "exact", network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0x40f100ccCF51EEA928a3f314fB6ab63Bf8fa51F3", amount: "3000" }, payload: {}, extensions: { "builder-code": { a: "bc_other" } } };
  const r = await call({ BUILDER_CODE: "bc_test1234" }, { "PAYMENT-SIGNATURE": b64(payload) });
  assert.equal(r.status, 402);
  assert.match(unb64(r.headers.get("PAYMENT-REQUIRED")).error, /extension_echo_mismatch/);
  setBuilderCode("");
});
