import { Swap } from "@balancer/sdk";
import { Avatar } from '@circles-sdk/sdk';
import { TokenBalanceRow } from '@circles-sdk/data';

export interface Bot {
    avatar?: Avatar;
    groupMembersCache: MembersCache;
    address: string;
    groupAddress: string;
    groupTokenAddress: string;
    approvedTokens: string[]
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

export interface GuessAmountOut {
    amountOut: bigint;
    swapData: Swap | null;
}

export enum ArbDirection {
    REDEEM = "REDEEM",
    GROUP_MINT = "GROUP_MINT",
}

export type PlaceOrderResult = 
    | { success: true; orderId: string }
    | { success: false; error: string };

export type NextPick = 
    | { member: GroupMember, direction: ArbDirection , swap: Swap }
    | null;

