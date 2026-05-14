import { createClient, createAccount } from "genlayer-js";
import {
  localnet,
  studionet,
  testnetAsimov,
  testnetBradbury,
} from "genlayer-js/chains";

export type SupportedGenlayerNetwork =
  | "localnet"
  | "studionet"
  | "testnet-asimov"
  | "testnet-bradbury";

type GenlayerNetworkConfig = {
  alias: SupportedGenlayerNetwork;
  chain: any;
  defaultRpc: string;
  defaultExplorer: string;
  defaultConsensusMainContract: string;
};

type ResolvedNetworkOption = {
  alias: SupportedGenlayerNetwork;
  name: string;
  shortName: string;
  hasContract: boolean;
};

const DEFAULT_NETWORK_ALIAS: SupportedGenlayerNetwork = "studionet";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const CLIENT_NETWORK_STORAGE_KEY = "proven.genlayer.network";

const NETWORK_CONFIGS: Record<SupportedGenlayerNetwork, GenlayerNetworkConfig> = {
  localnet: {
    alias: "localnet",
    chain: localnet,
    defaultRpc: "http://127.0.0.1:4000/api",
    defaultExplorer: "http://127.0.0.1:4000/api",
    defaultConsensusMainContract: "0xb7278A61aa25c888815aFC32Ad3cC52fF24fE575",
  },
  studionet: {
    alias: "studionet",
    chain: studionet,
    defaultRpc: "https://studio.genlayer.com/api",
    defaultExplorer: "https://explorer-studio.genlayer.com",
    defaultConsensusMainContract: "0xb7278A61aa25c888815aFC32Ad3cC52fF24fE575",
  },
  "testnet-asimov": {
    alias: "testnet-asimov",
    chain: testnetAsimov,
    defaultRpc: "https://rpc-asimov.genlayer.com",
    defaultExplorer: "https://explorer-asimov.genlayer.com",
    defaultConsensusMainContract: "0x6CAFF6769d70824745AD895663409DC70aB5B28E",
  },
  "testnet-bradbury": {
    alias: "testnet-bradbury",
    chain: testnetBradbury,
    defaultRpc: "https://rpc-bradbury.genlayer.com",
    defaultExplorer: "https://explorer-bradbury.genlayer.com",
    defaultConsensusMainContract: "0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D",
  },
};

const NETWORK_ALIASES: Record<string, SupportedGenlayerNetwork> = {
  local: "localnet",
  localnet: "localnet",
  studio: "studionet",
  studionet: "studionet",
  asimov: "testnet-asimov",
  "testnet-asimov": "testnet-asimov",
  bradbury: "testnet-bradbury",
  "testnet-bradbury": "testnet-bradbury",
};

const PUBLIC_NETWORK_CONTRACT_ADDRESSES: Partial<
  Record<SupportedGenlayerNetwork, string | undefined>
> = {
  localnet: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_LOCALNET,
  studionet: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_STUDIONET,
  "testnet-asimov": process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_TESTNET_ASIMOV,
  "testnet-bradbury": process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_TESTNET_BRADBURY,
};

function trimNetworkName(networkName: string) {
  return networkName
    .replace(/^GenLayer\s+/i, "")
    .replace(/\s+Chain$/i, "")
    .trim();
}

export function parseSupportedGenlayerNetwork(
  network: string | undefined | null
): SupportedGenlayerNetwork | null {
  const normalized = String(network ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return NETWORK_ALIASES[normalized] ?? null;
}

function inferNetworkAliasFromEndpoint(
  endpoint: string | undefined
): SupportedGenlayerNetwork | null {
  if (!endpoint) {
    return null;
  }

  const normalized = endpoint.toLowerCase();
  if (normalized.includes("127.0.0.1") || normalized.includes("localhost")) {
    return "localnet";
  }
  if (normalized.includes("studio.genlayer.com")) {
    return "studionet";
  }
  if (normalized.includes("rpc-asimov.genlayer.com")) {
    return "testnet-asimov";
  }
  if (normalized.includes("rpc-bradbury.genlayer.com")) {
    return "testnet-bradbury";
  }

  return null;
}

function getConfiguredNetworkFromEnv() {
  return parseSupportedGenlayerNetwork(
    process.env.NEXT_PUBLIC_GENLAYER_NETWORK || process.env.GENLAYER_NETWORK
  );
}

function getBaseConfiguredEndpointFromEnv() {
  return (
    process.env.NEXT_PUBLIC_GENLAYER_RPC ||
    (typeof window === "undefined" ? process.env.GENLAYER_RPC : undefined)
  );
}

function getBaseConfiguredExplorerOverride() {
  return (
    process.env.NEXT_PUBLIC_GENLAYER_EXPLORER ||
    process.env.GENLAYER_EXPLORER ||
    undefined
  );
}

function getBaseConfiguredMainContractOverride() {
  return (
    process.env.NEXT_PUBLIC_GENLAYER_MAIN_CONTRACT ||
    process.env.GENLAYER_MAIN_CONTRACT ||
    undefined
  );
}

function getBaseConfiguredContractAddressFromEnv() {
  return process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || undefined;
}

function getBaseNetworkAlias(): SupportedGenlayerNetwork {
  return (
    getConfiguredNetworkFromEnv() ??
    inferNetworkAliasFromEndpoint(getBaseConfiguredEndpointFromEnv()) ??
    DEFAULT_NETWORK_ALIAS
  );
}

function getStoredClientNetworkPreference() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storedPreference = parseSupportedGenlayerNetwork(
      window.localStorage.getItem(CLIENT_NETWORK_STORAGE_KEY)
    );
    if (storedPreference === "testnet-bradbury") {
      window.localStorage.removeItem(CLIENT_NETWORK_STORAGE_KEY);
      return null;
    }
    return storedPreference;
  } catch {
    return null;
  }
}

function resolveNetworkAlias(
  network?: SupportedGenlayerNetwork | null
): SupportedGenlayerNetwork {
  return network ?? getStoredClientNetworkPreference() ?? getBaseNetworkAlias();
}

function getResolvedNetworkConfig(
  network?: SupportedGenlayerNetwork | null
): GenlayerNetworkConfig {
  return NETWORK_CONFIGS[resolveNetworkAlias(network)];
}

export const GENLAYER_CONSENSUS_MAIN_ABI = (
  NETWORK_CONFIGS[getBaseNetworkAlias()].chain as any
).consensusMainContract.abi;

export function getBaseConfiguredNetworkAlias(): SupportedGenlayerNetwork {
  return getBaseNetworkAlias();
}

export function getConfiguredNetworkAlias(
  network?: SupportedGenlayerNetwork | null
): SupportedGenlayerNetwork {
  return resolveNetworkAlias(network);
}

export function getConfiguredNetworkName(
  network?: SupportedGenlayerNetwork | null
) {
  return getResolvedNetworkConfig(network).chain.name;
}

export function getConfiguredExplorerBaseUrl(
  network?: SupportedGenlayerNetwork | null
) {
  const resolvedNetwork = resolveNetworkAlias(network);
  if (resolvedNetwork === getBaseNetworkAlias()) {
    return getBaseConfiguredExplorerOverride() || getResolvedNetworkConfig(network).defaultExplorer;
  }
  return getResolvedNetworkConfig(network).defaultExplorer;
}

export function setClientPreferredNetworkAlias(
  network: SupportedGenlayerNetwork | null
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const nextAlias = network && network !== getBaseNetworkAlias() ? network : null;
    if (nextAlias) {
      window.localStorage.setItem(CLIENT_NETWORK_STORAGE_KEY, nextAlias);
    } else {
      window.localStorage.removeItem(CLIENT_NETWORK_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures and let the page continue with the base env network.
  }
}

export function isRuntimeNetworkOverrideActive() {
  return getConfiguredNetworkAlias() !== getBaseNetworkAlias();
}

export function getConfiguredContractAddress(
  network?: SupportedGenlayerNetwork | null
) {
  const resolvedNetwork = resolveNetworkAlias(network);
  const explicitAddress = PUBLIC_NETWORK_CONTRACT_ADDRESSES[resolvedNetwork];
  if (explicitAddress) {
    return explicitAddress;
  }

  if (resolvedNetwork === getBaseNetworkAlias()) {
    return getBaseConfiguredContractAddressFromEnv() || ZERO_ADDRESS;
  }

  return ZERO_ADDRESS;
}

export function hasConfiguredContractAddress(
  network?: SupportedGenlayerNetwork | null
) {
  return getConfiguredContractAddress(network) !== ZERO_ADDRESS;
}

export function getSwitchableNetworkOptions(): ResolvedNetworkOption[] {
  const preferredOrder: SupportedGenlayerNetwork[] = [
    "studionet",
    "testnet-bradbury",
    "localnet",
    "testnet-asimov",
  ];

  return preferredOrder
    .map((alias) => {
      const config = NETWORK_CONFIGS[alias];
      return {
        alias,
        name: config.chain.name,
        shortName: trimNetworkName(config.chain.name),
        hasContract: hasConfiguredContractAddress(alias),
      };
    })
    .filter((option) => option.hasContract || option.alias === getBaseNetworkAlias());
}

export function getConsensusMainAbi(
  network?: SupportedGenlayerNetwork | null
) {
  return (getResolvedNetworkConfig(network).chain as any).consensusMainContract.abi;
}

export function getEndpoint(network?: SupportedGenlayerNetwork | null) {
  const resolvedNetwork = resolveNetworkAlias(network);
  if (resolvedNetwork === getBaseNetworkAlias()) {
    const explicitEndpoint = getBaseConfiguredEndpointFromEnv();
    if (explicitEndpoint) {
      return explicitEndpoint;
    }
  }

  return NETWORK_CONFIGS[resolvedNetwork].defaultRpc;
}

function isLocalEndpoint(endpoint?: string) {
  if (!endpoint) {
    return false;
  }

  try {
    const url = new URL(endpoint);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return endpoint.includes("127.0.0.1") || endpoint.includes("localhost");
  }
}

export function getConsensusMainContractAddress(
  network?: SupportedGenlayerNetwork | null
) {
  const resolvedNetwork = resolveNetworkAlias(network);
  if (resolvedNetwork === getBaseNetworkAlias()) {
    const override = getBaseConfiguredMainContractOverride();
    if (override) {
      return override;
    }
  }

  return NETWORK_CONFIGS[resolvedNetwork].defaultConsensusMainContract;
}

function getChain(
  endpoint?: string,
  network?: SupportedGenlayerNetwork | null
) {
  const resolvedNetwork = resolveNetworkAlias(network);
  const baseNetwork = NETWORK_CONFIGS[resolvedNetwork];
  const resolvedEndpoint = endpoint || getEndpoint(resolvedNetwork) || baseNetwork.defaultRpc;
  const activeNetwork = isLocalEndpoint(resolvedEndpoint)
    ? NETWORK_CONFIGS.localnet
    : baseNetwork;
  const mainContractAddress = getConsensusMainContractAddress(activeNetwork.alias);

  return {
    ...activeNetwork.chain,
    rpcUrls: {
      default: {
        http: [resolvedEndpoint],
      },
    },
    ...(mainContractAddress !== activeNetwork.defaultConsensusMainContract
      ? {
          consensusMainContract: {
            ...(activeNetwork.chain as any).consensusMainContract,
            address: mainContractAddress,
          },
        }
      : {}),
  };
}

export function getGenlayerChain(network?: SupportedGenlayerNetwork | null) {
  return getChain(getEndpoint(network), network);
}

export function getExplorerBaseUrl(network?: SupportedGenlayerNetwork | null) {
  const resolvedNetwork = resolveNetworkAlias(network);
  const configuredOverride =
    resolvedNetwork === getBaseNetworkAlias()
      ? getBaseConfiguredExplorerOverride()
      : undefined;

  return (
    configuredOverride || NETWORK_CONFIGS[resolvedNetwork].defaultExplorer
  ).replace(/\/+$/, "");
}

export function getWalletChainParams(network?: SupportedGenlayerNetwork | null) {
  const selectedNetwork = getResolvedNetworkConfig(network);
  const endpoint = getEndpoint(selectedNetwork.alias) || selectedNetwork.defaultRpc;
  return {
    chainId: `0x${selectedNetwork.chain.id.toString(16)}`,
    chainName: selectedNetwork.chain.name,
    rpcUrls: [endpoint],
    nativeCurrency: selectedNetwork.chain.nativeCurrency,
    blockExplorerUrls: [getExplorerBaseUrl(selectedNetwork.alias)],
  };
}

export async function ensureGenlayerWalletChain(ethereum: {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
}, network?: SupportedGenlayerNetwork | null) {
  const params = getWalletChainParams(network);
  const currentChainId = (await ethereum.request({
    method: "eth_chainId",
  })) as string;

  if (currentChainId === params.chainId) {
    // If the wallet is already on the expected chain, avoid re-adding it.
    // MetaMask logs noisy RPC errors when asked to "update" a network to the
    // exact same RPC endpoint and chain id.
    return;
  }

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: params.chainId }],
    });
  } catch (error: any) {
    if (error?.code !== 4902) {
      throw error;
    }

    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [params],
    });
  }
}

function isConsensusInitNoise(args: unknown[]) {
  const [first, second] = args;
  return (
    typeof first === "string" &&
    first.includes("Failed to initialize consensus smart contract:") &&
    second instanceof Error &&
    second.message === "Client is not connected to the simulator"
  );
}

function createClientWithoutConsensusNoise(factory: () => ReturnType<typeof createClient>) {
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    if (isConsensusInitNoise(args)) {
      return;
    }
    originalConsoleError(...(args as Parameters<typeof console.error>));
  };

  try {
    const client = factory();
    queueMicrotask(() => {
      console.error = originalConsoleError;
    });
    return client;
  } catch (error) {
    console.error = originalConsoleError;
    throw error;
  }
}

export function createGenlayerClient(accountAddress?: string) {
  const network = getConfiguredNetworkAlias();
  const endpoint = getEndpoint(network);

  return createClientWithoutConsensusNoise(() =>
    createClient({
      chain: getChain(endpoint, network),
      ...(accountAddress 
        ? { account: accountAddress as any}
        : { account: null as any}),
    } as any)
  );
}

export function createGenlayerClientWithKey(privateKey: string) {
  const account = createAccount(privateKey as any);
  const network = getConfiguredNetworkAlias();
  const endpoint = getEndpoint(network);

  return createClientWithoutConsensusNoise(() =>
    createClient({
      chain: getChain(endpoint, network),
      account,
    } as any)
  );
}

export function getExplorerUrl(network?: SupportedGenlayerNetwork | null) {
  return `${getExplorerBaseUrl(network)}/txs`;
}

export function getExplorerTxUrl(
  txHash: string,
  network?: SupportedGenlayerNetwork | null
) {
  return `${getExplorerBaseUrl(network)}/tx/${txHash}`;
}

export { createAccount };
