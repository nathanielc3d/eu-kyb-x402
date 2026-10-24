# eu-kyb-x402

**A pay-per-call EU KYB API for AI agents, paid with [x402](https://x402.org) in USDC on Base. No account, no API key, no subscription.**

Live at **https://eu-kyb-x402.moneymachine.workers.dev**, a single dependency-free file (`worker.js`) running on Cloudflare Workers.

> **Disclosure:** this project was built and is operated by an autonomous AI agent, as part of a public, filmed "Money Machine" challenge.
> The human operator, accountable for it, is **Nathaniel** ([@nathanielpsg](https://x.com/nathanielpsg), nathanielcloud3@gmail.com).
> Data comes from official open sources (EU VIES, French INSEE/RNE open data) and is provided as-is, with no warranty.

## Why
AI agents that do invoicing, procurement or B2B onboarding need to check counterparties. The official sources are heterogeneous (SOAP/REST, rate limits, different schemas) and agents can't sign up for SaaS plans.
This API gives them one clean JSON response per call for a fraction of a cent, paid per request over HTTP 402.

- Input is validated **before** payment, so a malformed VAT/SIREN returns `400` and the agent is never charged.
- If an upstream source is down, the API returns `502` and the payment is **not** settled (verify → execute → settle).
- Supports x402 **v2** (`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`) and v1 (`X-PAYMENT`) clients.
- Discoverable: `/.well-known/x402`, `/openapi.json` (with `x-payment-info`), `/llms.txt`, and a Bazaar discovery extension in every 402.

## Endpoints

| Route | Price (USDC) | What you get |
|---|---|---|
| `GET /v1/eu/vat?vat=FR39356000000` | 0.003 | Live EU VAT validation via EU VIES (27 member states + XI): validity, registered name and address |
| `GET /v1/fr/company?siren=356000000` or `?q=la poste` | 0.005 | French company KYB card from official open data: status, legal form, NAF code, HQ, headcount band, directors, latest financials, labels, plus computed VAT number and live VIES check |
| `GET /v1/agent-jobs` | 0.003 | Normalized live feed of funded, agent-eligible paid tasks (Taskmarket on Base, Superteam Earn agent listings) |

Free: `/` (HTML/JSON catalogue), `/.well-known/x402`, `/openapi.json`, `/llms.txt`, `/health`, `/v1/sample/fr/company`.

Payment details: scheme `exact`, network `eip155:8453` (Base mainnet), asset USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`,
payTo `0x40f100ccCF51EEA928a3f314fB6ab63Bf8fa51F3`. Facilitator: [PayAI](https://facilitator.payai.network), which pays gas, so the payer only needs USDC.

## How to call it (x402 v2)

**1. Call without paying to get a 402 with the payment requirements:**
```bash
curl -si "https://eu-kyb-x402.moneymachine.workers.dev/v1/eu/vat?vat=FR39356000000" \
  | grep -i '^payment-required:' | cut -d' ' -f2 | tr -d '\r' | base64 -d | jq '.accepts'
```
```json
[{ "scheme": "exact", "network": "eip155:8453", "amount": "3000",
   "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
   "payTo": "0x40f100ccCF51EEA928a3f314fB6ab63Bf8fa51F3",
   "maxTimeoutSeconds": 120, "extra": { "name": "USD Coin", "version": "2" } }]
```

**2. Sign an EIP-3009 `transferWithAuthorization` for that amount and retry with the `PAYMENT-SIGNATURE` header.** Any x402 client does this for you:
```js
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.PAYER_KEY); // a wallet holding a little USDC on Base
const pay = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],
});
const r = await pay("https://eu-kyb-x402.moneymachine.workers.dev/v1/eu/vat?vat=FR39356000000");
console.log(await r.json()); // { valid: true, name: "...", address: "...", source: "EU VIES" }
```

**3. The response carries a `PAYMENT-RESPONSE` header** with the settlement transaction on Base.

## Run / deploy your own
```bash
npm install
npm test                 # local smoke test of discovery routes and 402/400 behaviour (no network payment)
npx wrangler dev         # local server
npx wrangler deploy      # deploy to your Cloudflare account
```
Change `PAY_TO` at the top of `worker.js` to your own address. `wrangler.toml` binds an optional `STATS` KV namespace for anonymous per-route counters. Replace its id with your own, or remove it; the worker works without it.

## License
MIT. See [LICENSE](LICENSE).
