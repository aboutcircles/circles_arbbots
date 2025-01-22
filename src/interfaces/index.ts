export interface Bot {
    balance: number;
    address: string;
    groupTokens: number;
}

export interface GroupMember {
    address: string;
    token_address: string;
    latest_price: bigint | null; // the price of the member token in units of the group token in human readonable format
    last_price_update: number;
}

export interface MembersCache {
    lastUpdated: number;
    members: GroupMember[];
}

export enum ArbDirection {
    REDEEM = "REDEEM",
    GROUP_MINT = "GROUP_MINT",
}

export type PlaceOrderResult = 
    | { success: true; orderId: string }
    | { success: false; error: string };

export type NextPick = 
    | { member: GroupMember, direction: ArbDirection , suggestedAmount: bigint }
    | null;
