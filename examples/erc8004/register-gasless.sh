#!/usr/bin/env bash
# Gasless ERC-8004 registration through the Ultravioleta DAO facilitator (no key, no account, it pays the gas,
# mints the identity NFT and transfers it to RECIPIENT). Networks: see GET https://facilitator.ultravioletadao.xyz/register
# (avalanche, base, celo, polygon, ...; GOAT Network is NOT in that list, use register-goat.mjs for GOAT).
# Not run automatically: minting an on-chain identity is public and permanent.
set -euo pipefail
NETWORK="${NETWORK:-avalanche}"
RECIPIENT="${RECIPIENT:-0x40f100ccCF51EEA928a3f314fB6ab63Bf8fa51F3}"
AGENT_URI="${AGENT_URI:-https://eu-kyb-x402.moneymachine.workers.dev/.well-known/agent-registration.json}"
curl -sS -X POST https://facilitator.ultravioletadao.xyz/register -H 'content-type: application/json' \
  -d "{\"x402Version\":1,\"network\":\"$NETWORK\",\"agentUri\":\"$AGENT_URI\",\"recipient\":\"$RECIPIENT\"}"
echo
