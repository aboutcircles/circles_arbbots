import { Swap } from "@balancer/sdk";
import { TokenBalanceRow } from '@circles-sdk/data';


export interface Bot {
    balances: TokenBalanceRow[];
    address: string;
    groupAddress: string;
    groupTokenAddress: string;
}

export interface GroupMember {
    address: string;
    token_address: string;
    latest_price: bigint | null; // the price of the member token in units of the group token in human readonable format
    last_price_update: number | null; // the timestamp of the last price update
}

export interface MembersCache {
    lastUpdated: number;
    members: GroupMember[];
}

export interface Deal {
    isExecutable?: boolean;
    tokenIn: string;
    tokenOut: string;
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

