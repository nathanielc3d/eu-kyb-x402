// Real @x402/fetch client against the live API, using a THROWAWAY wallet created in memory
// (never funded, key never printed or saved). Expected outcome: the PayAI facilitator rejects
// the signed USDC authorization for insufficient balance -> proves the full wiring.
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const API = process.env.API || "https://eu-kyb-x402.moneymachine.workers.dev";
const url = `${API}/v1/eu/vat?vat=FR39356000000`;
const account = privateKeyToAccount(generatePrivateKey()); // in memory only
console.log("throwaway wallet:", account.address, "(0 USDC, never funded)");

const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(account));
const payFetch = wrapFetchWithPayment(fetch, client);

console.log("GET", url);
const res = await payFetch(url);
console.log("HTTP", res.status);
const pr = res.headers.get("payment-response");
if (pr) console.log("PAYMENT-RESPONSE:", JSON.stringify(JSON.parse(Buffer.from(pr, "base64").toString())));
const preq = res.headers.get("payment-required");
if (preq) console.log("PAYMENT-REQUIRED.error:", JSON.parse(Buffer.from(preq, "base64").toString()).error);
const body = await res.text();
console.log("body:", body.slice(0, 300).replace(/\s+/g, " "));
