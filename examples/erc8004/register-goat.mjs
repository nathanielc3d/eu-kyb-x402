// Register this API as an ERC-8004 agent on GOAT Network mainnet (chain 2345) or any chain that has the
// canonical Identity Registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 (Base, Avalanche, ...).
// DRY RUN by default: reads the registry, estimates gas and cost, checks the owner balance, prints calldata.
// It only sends with --send AND a PRIVATE_KEY env var (never printed). Needs a little native gas (BTC on GOAT).
//
//   node examples/erc8004/register-goat.mjs                       # dry run on GOAT mainnet
//   RPC=https://api.avax.network/ext/bc/C/rpc node examples/erc8004/register-goat.mjs
//   PRIVATE_KEY=0x... node examples/erc8004/register-goat.mjs --send
// After minting: put [{ "agentId": <id>, "agentRegistry": "eip155:<chainId>:0x8004A169..." }] in
// wrangler.toml AGENT_REGISTRATIONS and redeploy, so the registration file points back at the on-chain id.
import { createPublicClient, createWalletClient, http, encodeFunctionData, formatEther, parseAbi, parseEventLogs, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC || "https://rpc.goat.network";
const REGISTRY = process.env.REGISTRY || "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const AGENT_URI = process.env.AGENT_URI || "https://eu-kyb-x402.moneymachine.workers.dev/.well-known/agent-registration.json";
const OWNER = process.env.OWNER || "0x40f100ccCF51EEA928a3f314fB6ab63Bf8fa51F3";
const abi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function getVersion() view returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

const pub = createPublicClient({ transport: http(RPC) });
const chainId = await pub.getChainId();
const chain = defineChain({ id: chainId, name: "chain-" + chainId, nativeCurrency: { name: "native", symbol: "NATIVE", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const card = await (await fetch(AGENT_URI)).json();
if (card.type !== "https://eips.ethereum.org/EIPS/eip-8004#registration-v1") throw new Error("agentURI does not serve an ERC-8004 registration file");
const version = await pub.readContract({ address: REGISTRY, abi, functionName: "getVersion" });
const already = await pub.readContract({ address: REGISTRY, abi, functionName: "balanceOf", args: [OWNER] });
const data = encodeFunctionData({ abi, functionName: "register", args: [AGENT_URI] });
const gas = await pub.estimateGas({ account: OWNER, to: REGISTRY, data });
const gasPrice = await pub.getGasPrice();
const balance = await pub.getBalance({ address: OWNER });
console.log({ chainId, registry: REGISTRY, registryVersion: version, agentRegistry: `eip155:${chainId}:${REGISTRY}`, agentURI: AGENT_URI,
  owner: OWNER, identitiesAlreadyOwned: already.toString(), gas: gas.toString(), estCostNative: formatEther(gas * gasPrice * 12n / 10n), ownerBalanceNative: formatEther(balance), calldata: data });

if (!process.argv.includes("--send")) { console.log("dry run only (add --send and PRIVATE_KEY to broadcast)"); process.exit(0); }
if (already > 0n && !process.argv.includes("--again")) throw new Error("owner already holds an identity on this registry; add --again to mint another");
if (balance < gas * gasPrice * 12n / 10n) throw new Error("owner has not enough native gas on chain " + chainId);
const account = privateKeyToAccount(process.env.PRIVATE_KEY);
if (account.address.toLowerCase() !== OWNER.toLowerCase()) throw new Error("PRIVATE_KEY does not match OWNER");
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const hash = await wallet.sendTransaction({ to: REGISTRY, data, gas: gas * 12n / 10n });
const receipt = await pub.waitForTransactionReceipt({ hash });
const ev = parseEventLogs({ abi, logs: receipt.logs }).find((l) => l.eventName === "Registered" || l.eventName === "Transfer");
const agentId = ev && (ev.args.agentId ?? ev.args.tokenId);
console.log({ tx: hash, status: receipt.status, agentId: agentId?.toString(), AGENT_REGISTRATIONS: JSON.stringify([{ agentId: Number(agentId), agentRegistry: `eip155:${chainId}:${REGISTRY}` }]) });
