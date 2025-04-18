import { Contract } from "ethers";
import { Swap } from "@balancer/sdk";
import { Avatar } from "@circles-sdk/sdk";

export interface Bot {
  avatar?: Avatar;
  groupTokenAddress?: string;
  redeemOperatorContract?: Contract;
  baseRedemptionEncoderContract?: Contract;
  bouncerOrgContract?: Contract;
  groupAddress: string;
  groupMembersCache: MembersCache;
  address: string;
  approvedTokens: string[];
}

export interface GroupMember {
  address: string;
  tokenAddress: string;
  latestPrice?: bigint; // the price of the member token in units of the group token in human readonable format
  lastPriceUpdate?: number; // the timestamp of the last price update
}

export interface MembersCache {
  lastUpdated: number;
  members: GroupMember[];
}

export interface Deal {
  isProfitable?: boolean;
  swapData?: Swap | null;
}

export enum ArbDirection {
  BUY_MEMBER_TOKENS,
  BUY_GROUP_TOKENS,
}
export interface FetchBalancerQuoteParams {
  tokenAddress: string;
  direction?: ArbDirection;
  amountOut?: bigint;
  logQuote?: boolean;
}
