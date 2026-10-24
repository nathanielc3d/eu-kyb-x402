// For each accepted network: official @x402/fetch client with a THROWAWAY in-memory wallet (0 USDC, key never
// printed or saved) pays the API; expected result = the real facilitator rejects for insufficient funds.
// API=<url> to target production; default = the local worker module (real facilitators, real network).
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
const API = process.env.API;
let target = fetch;
if (!API) { const { default: worker } = await import("../src/worker.js"); target = (i, init) => worker.fetch(new Request(i, init), {}, { waitUntil() {} }); }
const base = API || "https://local.test";
const nets = (process.env.NETS || "eip155:8453,eip155:43114,eip155:137,eip155:42220").split(",");
const account = privateKeyToAccount(generatePrivateKey());
console.log("throwaway wallet", account.address, "(never funded)");
for (const n of nets) {
  const client = new x402Client();
  client.register(n, new ExactEvmScheme(account));
  let sent;
  const spy = async (i, init) => { const r = new Request(i, init); const h = r.headers.get("PAYMENT-SIGNATURE"); if (h) sent = JSON.parse(Buffer.from(h, "base64").toString()); return target(r); };
  const res = await wrapFetchWithPayment(spy, client)(`${base}/v1/iban?iban=DE89370400440532013000`);
  const pr = res.headers.get("payment-required");
  console.log(n.padEnd(14), "signed for", sent?.accepted?.network, "asset", sent?.accepted?.asset, "-> HTTP", res.status, "|", pr ? JSON.parse(Buffer.from(pr, "base64").toString()).error : (await res.text()).slice(0, 100));
}
