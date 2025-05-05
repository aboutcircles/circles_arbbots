import { Swap, Token } from "@balancer/sdk";

// @todo: Make these 0xstrings.
export type Address = `0x${string}`;

export interface CirclesNode {
  avatar: Address;
  erc20tokenAddress: Address;
  // tokenId: string;
  lastUpdated: number;
  isGroup: boolean;
  mintHandler?: Address;
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
  mintHandler: Address;
}

export interface LatestPriceRow {
  price: bigint;
  timestamp: number;
}

export interface SwapExecutionOptions {
  slippage: number;
  maxRetries?: number;
  retryDelay?: number;
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
  quotingToken: Address;
  collateralTokenDecimals: number;
  tradingToken: Address;
  tradingTokenDecimals: number;
}
