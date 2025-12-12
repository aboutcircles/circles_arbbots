import { Swap, Token } from "@balancer/sdk";

// @todo: Make these 0xstrings.
export type Address = `0x${string}`;

export interface PoolInfo {
  poolId: string; // For V2: bytes32 poolId, For V3: pool address
  isV3: boolean;
  intermediateToken: Address; // The non-CRC token in the pool (WETH, sDAI, WBTC, GNO, wstETH)
}

export interface CirclesNode {
  avatar: Address;
  erc20tokenAddress: Address;
  // tokenId: string;
  lastUpdated: number;
  isGroup: boolean;
  pools?: PoolInfo[]; // Balancer V2 and V3 pools
  price?: bigint;
}

export interface CirclesEdge {
  liquidity: bigint;
  lastUpdated: number;
}

export interface Trade {
  buyQuote: Swap;
  sellQuote: Swap;
  buyNode: CirclesNode;
  sellNode: CirclesNode;
  amount: bigint;
  profit: bigint;
}

export interface EdgeInfo {
  edge: CirclesEdge;
  source: CirclesNode;
  target: CirclesNode;
  edgeKey: string;
  sourceKey: string;
  targetKey: string;
}

export enum Direction {
  BUY,
  SELL,
}

export interface FetchBalancerQuoteParams {
  tokenIn: Token;
  tokenOut: Token;
  direction: Direction;
  amount: bigint;
  logQuote?: boolean;
  skipSwapCallPreparation?: boolean;
}

export interface BalanceRow {
  account: Address;
  demurragedTotalBalance: bigint; // or number, depending on how you want to handle the balance
  tokenAddress: Address;
}

export interface TrustRelationRow {
  truster: Address;
  trustee: Address;
}

export interface BaseGroupRow {
  address: Address;
  erc20tokenAddress: Address;
}

export interface TradeExecutionResult {
  success: boolean;
  boughtAmount?: bigint;
  soldAmount?: bigint;
  error?: string;
}

export interface DataInterfaceParams {
  quoteReferenceAmount: bigint;
  logActivity: boolean;
}

export interface PoolToken {
  address: Address;
  symbol: string;
  name: string;
  balance: string;
  weight: string;
  decimals: number;
}

export interface PoolDynamicData {
  totalLiquidity: string;
  volume24h: string;
}

export interface BalancerPool {
  id: string;
  address: Address;
  name: string;
  symbol: string;
  type: string;
  protocolVersion: number; // 2 or 3
  dynamicData: PoolDynamicData;
  poolTokens: PoolToken[];
}

export interface PriceResult {
  erc20TokensAddress: string;
  prices: bigint[];
}

export interface QuotePricesResult {
  prices: PriceResult[];
}
