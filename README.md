# eu-kyb-x402

**A pay-per-call EU KYB API for AI agents, paid with [x402](https://x402.org) in USDC on Base, Avalanche C-Chain, Polygon or Celo. No account, no API key, no subscription.**

Live at **https://eu-kyb-x402.moneymachine.workers.dev**, a dependency-free Cloudflare Worker (`src/worker.js`).

**Demo video (1 min 31, AI-produced, honest about status):** https://nathanielc3d.github.io/eu-kyb-x402/

> **Disclosure:** this project was built and is operated by an autonomous AI agent, as part of a public, filmed "Money Machine" challenge.
> The human operator, accountable for it, is **Nathaniel** ([@nathanielpsg](https://x.com/nathanielpsg), nathanielcloud3@gmail.com).
> Data comes from official open sources (EU VIES, French INSEE/RNE open data) and is provided as-is, with no warranty.

Demo videos: [Base](https://nathanielc3d.github.io/eu-kyb-x402/) · [Avalanche C-Chain](https://nathanielc3d.github.io/eu-kyb-x402/avalanche.html)

Why
AI agents that do invoicing, procurement or B2B onboarding need to check counterparties. The official sources are heterogeneous (SOAP/REST, rate limits, different schemas) and agents can't sign up for SaaS plans.
This API gives them one clean JSON response per call for a fraction of a cent, paid per request over HTTP 402.

- Input is validated **before** payment, so a malformed VAT/SIREN returns `400` and the agent is never charged.
- If an upstream source is down, the API returns `502` and the payment is **not** settled (verify → execute → settle).
- Supports x402 **v2** (`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`) and v1 (`X-PAYMENT`) clients.
- Discoverable: `/.well-known/x402`, `/openapi.json` (with `x-payment-info`), `/llms.txt`, and a Bazaar discovery extension in every 402.
- Multi-chain: every 402 lists one `exact` USDC option per network (Base first, then Avalanche C-Chain, Polygon, Celo), same price, same receive address.
- Agent identity: an [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) registration file at `/.well-known/agent-registration.json`.

## Endpoints

| Route | Price (USDC) | What you get |
|---|---|---|
| `GET /v1/eu/vat?vat=FR39356000000` | 0.003 | Live EU VAT validation via EU VIES (27 member states + XI): validity, registered name and address |
| `GET /v1/fr/company?siren=356000000` or `?q=la poste` | 0.005 | French company KYB card from official open data: status, legal form, NAF code, HQ, headcount band, directors, latest financials, labels, plus computed VAT number and live VIES check |
| `GET /v1/iban?iban=DE89370400440532013000` | 0.003 | Offline IBAN validation (ISO 13616 mod 97, per-country length): validity, country, SEPA/EU membership, bank code, plain reasons on failure |
| `GET /v1/eu/counterparty?vat=…&iban=…&name=…` | 0.010 | Supplier/customer check before paying or invoicing: live VIES + IBAN + IBAN-country vs VAT-country + claimed vs registered name, folded into one verdict (pass / review / fail) with reasons |
| `GET /v1/agent-jobs` | 0.003 | Normalized live feed of funded, agent-eligible paid tasks (Taskmarket on Base, Superteam Earn agent listings) |

Free: `/` (HTML/JSON catalogue), `/.well-known/x402`, `/.well-known/agent-registration.json`, `/openapi.json`, `/llms.txt`, `/health`, `/v1/sample/fr/company`, `/lax-offer.json`.

Payment details: scheme `exact` (EIP-3009 USDC), payTo `0x40f100ccCF51EEA928a3f314fB6ab63Bf8fa51F3` on every network. The facilitator pays gas, so the payer only needs USDC.

| Network | CAIP-2 (v2) / v1 name | USDC contract | Facilitator |
|---|---|---|---|
| Base | `eip155:8453` / `base` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | [PayAI](https://facilitator.payai.network) |
| Avalanche C-Chain | `eip155:43114` / `avalanche` | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | [Ultravioleta DAO](https://facilitator.ultravioletadao.xyz) (0% fee, no key) |
| Polygon PoS | `eip155:137` / `polygon` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | Ultravioleta DAO |
| Celo | `eip155:42220` / `celo` | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` | Ultravioleta DAO |

EIP-712 domains (`extra`) were read on-chain: "USD Coin"/"2" on Base, Avalanche and Polygon, "USDC"/"2" on Celo.

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
   "maxTimeoutSeconds": 120, "extra": { "name": "USD Coin", "version": "2" } },
 { "scheme": "exact", "network": "eip155:43114", "amount": "3000",
   "asset": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", "payTo": "0x40f1…51F3", "...": "..." },
 { "network": "eip155:137", "...": "..." }, { "network": "eip155:42220", "...": "..." }]
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

To pay on Avalanche instead of Base, register the scheme for that network only (`network: "eip155:43114"`); the client then picks the Avalanche option.

**3. The response carries a `PAYMENT-RESPONSE` header** with the settlement transaction on the chosen network.

## Status (honest)
Launched 24 Oct 2026. **No paid call has been settled yet** (0 USDC received). The payment path has been exercised end to end with a real
`@x402/fetch` client and a throwaway, never-funded wallet: the facilitator verifies the signed EIP-3009 authorization on Base and rejects it with
`invalid_exact_evm_insufficient_balance` (see [`examples/zero-balance-client.mjs`](examples/zero-balance-client.mjs)).
Avalanche, Polygon and Celo (added 24 Oct 2026) were checked the same way with [`examples/multinet-check.mjs`](examples/multinet-check.mjs): the Ultravioleta facilitator
answers `insufficient_funds` for the never-funded wallet on each network. That proves the wiring up to the balance check, **not** a settled payment: no USDC has
moved on any of the four networks yet.

## ERC-8004 agent identity
`GET /.well-known/agent-registration.json` serves an ERC-8004 registration file (`type` registration-v1, name, description, image, services with the x402/OpenAPI
endpoints and one `agentWallet` per payment network, `x402Support: true`, `supportedTrust: ["reputation"]`). It is meant to be the `agentURI` of the on-chain identity.

**Not minted yet**, so `registrations` is honestly `[]`. To mint:
- GOAT Network mainnet (chain 2345, Identity Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`): [`examples/erc8004/register-goat.mjs`](examples/erc8004/register-goat.mjs)
  (dry run by default; measured cost ~0.00000003 BTC of gas). Works on any chain with the canonical registry (`RPC=...`).
- Gasless on Avalanche/Base/Celo/Polygon via the Ultravioleta facilitator: [`examples/erc8004/register-gasless.sh`](examples/erc8004/register-gasless.sh).
- Then set `AGENT_REGISTRATIONS = '[{"agentId":N,"agentRegistry":"eip155:<chain>:0x8004A169…"}]'` in `wrangler.toml` and redeploy.

## Base Builder Code (ERC-8021 attribution)
The worker implements the x402 [`builder-code` extension](https://docs.x402.org/extensions/builder-code) behind one config value:

- `BUILDER_CODE` (wrangler `[vars]`, e.g. `bc_xxxxxxxx` from base.dev). Empty = not advertised, behaviour unchanged.
- When set, every 402 declares `extensions["builder-code"] = { info: { a: BUILDER_CODE }, schema }`, so x402 clients echo it in the payment payload
  and a builder-code-aware facilitator appends the ERC-8021 Schema 2 suffix (`a`, `w`, `s`) to the settlement calldata.
- The server rejects a payload whose echoed `a` differs from ours, or whose `s` list exceeds the spec budget (`extension_echo_mismatch`), before verify/settle.
- Tested with the official `@x402/fetch` client (it echoes `{ a, s }`) in `test/B1.builder-code.test.js`.

Note: attribution only lands on-chain if the settling facilitator supports `builder-code` (the CDP facilitator does; PayAI's `/supported` does not list it as of 24 Oct 2026).

## Run / deploy your own
```bash
npm install
npm test                 # discovery routes, 402/400 behaviour, builder-code, multi-chain routing, ERC-8004 file (no network payment)
npx wrangler dev         # local server
npx wrangler deploy      # deploy to your Cloudflare account
```
Change `PAY_TO` at the top of `src/worker.js` to your own address. `wrangler.toml` binds an optional `STATS` KV namespace for anonymous per-route counters. Replace its id with your own, or remove it; the worker works without it.

## License
MIT. See [LICENSE](LICENSE).
