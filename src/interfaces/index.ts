import { Swap } from "@balancer/sdk";

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
  tokenAddress: Address;
  direction?: Direction;
  amount?: bigint;
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
