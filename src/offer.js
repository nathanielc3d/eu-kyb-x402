// The LAX offer of this agent, generated from the route table so code and listing never drift.
export const FIVE_LAWS = ["Solidarity Oath", "Renewal Mandate", "Treasury Equilibrium", "Harm Shield", "Transparency Covenant"];
export const AGENT_DID = "did:pkh:eip155:8453:0x40f100ccCF51EEA928a3f314fB6ab63Bf8fa51F3";
export const ORIGIN = "https://eu-kyb-x402.moneymachine.workers.dev";

const vatOut = {
  type: "object", required: ["vat", "country", "valid", "status", "source"],
  properties: {
    vat: { type: "string" }, country: { type: "string", minLength: 2, maxLength: 2 }, valid: { type: "boolean" },
    status: { type: "string", description: "VIES userError, VALID or INVALID" }, name: { type: ["string", "null"] }, address: { type: ["string", "null"] },
    checked_at: { type: "string" }, source: { type: "string" }, _meta: { type: "object" },
  },
};
const ibanOut = {
  type: "object", required: ["iban", "valid", "country", "length", "sepa", "eu", "errors"],
  properties: {
    iban: { type: "string" }, valid: { type: "boolean" }, country: { type: ["string", "null"] }, check_digits: { type: ["string", "null"] }, bban: { type: ["string", "null"] },
    length: { type: "integer" }, expected_length: { type: ["integer", "null"] }, sepa: { type: "boolean" }, eu: { type: "boolean" }, bank_code: { type: ["string", "null"] },
    errors: { type: "array", items: { type: "string" } }, formatted: { type: "string" }, checked_at: { type: "string" }, source: { type: "string" }, _meta: { type: "object" },
  },
};
const cpOut = {
  type: "object", required: ["vat", "verdict", "reasons"],
  properties: {
    vat: vatOut, iban: { anyOf: [ibanOut, { type: "null" }] }, claimed_name: { type: ["string", "null"] },
    verdict: { type: "string", enum: ["pass", "review", "fail"] }, reasons: { type: "array", items: { type: "string" }, minItems: 1 },
    name_match: { type: ["number", "null"], minimum: 0, maximum: 1 }, checked_at: { type: "string" }, note: { type: "string" }, _meta: { type: "object" },
  },
};
export const OUTPUT_SCHEMAS = { "/v1/eu/vat": vatOut, "/v1/iban": ibanOut, "/v1/eu/counterparty": cpOut };
export const LAX_ROUTES = ["/v1/eu/counterparty", "/v1/eu/vat", "/v1/iban"];
export const SHORT = {
  "/v1/eu/counterparty": "GET /v1/eu/counterparty?vat=&iban=&name= : VIES VAT + IBAN + name check folded into one verdict (pass, review, fail) with reasons, before you pay or invoice.",
  "/v1/eu/vat": "GET /v1/eu/vat?vat= : live EU VIES validation of a VAT number (27 states + XI), with registered name and address when the state publishes them.",
  "/v1/iban": "GET /v1/iban?iban= : offline IBAN validation (mod 97, registry length), country, SEPA and EU flags, bank code, and plain reasons when it fails.",
};

export function inputSchema(path, route) {
  const props = {}, required = [];
  for (const [k, p] of Object.entries(route.params)) {
    props[k] = { type: p.type, description: p.description, examples: [p.example] };
    if (p.required) required.push(k);
  }
  return { type: "object", description: `GET ${path} with these query parameters`, properties: props, required, additionalProperties: false };
}

export function laxOffer(routes, origin = ORIGIN) {
  return {
    lax_version: "1.0",
    name: "Money Machine EU KYB",
    description: "Pay per call EU counterparty checks for agents that invoice, pay or onboard suppliers: live VIES VAT validation, offline IBAN validation, and a combined verdict (pass, review, fail) with plain reasons. USDC on Base over x402, no account. Built and operated by an AI agent run by Nathaniel. Refuses lookups of private persons, bulk scraping and non EU VAT numbers.",
    category: "compliance",
    endpoint: origin,
    agent_did: AGENT_DID,
    capabilities: LAX_ROUTES.map((p) => ({
      skill_id: routes[p].name,
      description: SHORT[p],
      pricing: { model: "per_call", amount: (Number(routes[p].price) / 1e6).toFixed(3), currency: "USDC", rail: "x402" },
      input_schema: inputSchema(p, routes[p]),
      output_schema: OUTPUT_SCHEMAS[p],
    })),
    constitutional_constraints: FIVE_LAWS,
    payment_rails: ["x402", "usdc-base"],
  };
}
