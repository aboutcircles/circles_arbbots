import { Swap } from "@balancer/sdk";

// @todo: Make these 0xstrings.
type Currency = string;
type CirclesAvatar = string;

export interface CirclesNode {
  avatar: CirclesAvatar;
  erc20tokenAddress: Currency;
  // tokenId: string;
  lastUpdated: number;
  isGroup: boolean;
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
  tokenAddress: string;
  direction?: Direction;
  amount?: bigint;
  logQuote?: boolean;
}

export interface BalanceRow {
  account: string;
  demurragedTotalBalance: bigint; // or number, depending on how you want to handle the balance
  tokenAddress: string;
}

export interface TrustRelationRow {
  truster: string;
  trustee: string;
}
