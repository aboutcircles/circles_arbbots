// TypeScript code for the Circles arbitrage bot
import { ethers } from "ethers";
import { OrderBookApi } from "@cowprotocol/cow-sdk";
import "dotenv/config";


interface Bot {
    balance: number;
    address: string;
    groupTokens: number;
}

interface GroupMember {
    address: string;
    token_address: string;
    latest_price: number;
    is_approved: boolean;
}

interface MembersCache {
    lastUpdated: number;
    members: GroupMember[];
}


enum OrderStatus {
    OPEN = "OPEN",
    FILLED = "FILLED",
    CANCELLED = "CANCELLED",
}

interface Order {
    id: string;
    orderStatus: OrderStatus;
}


// Constants
const epsilon: number = 0.01;
const validityCutoff: number = 60 * 60 * 1000; // 1 hour in ms
const waitingTime: number = 1000; // 1 second
const maxInvestingFraction: number = 0.1;
const bufferFraction: number = 0.95;
const maxOpenOrders: number = 10;

// constants loaded from environment variables
const botAddress = process.env.BOT_ADDRESS!;
const botPrivateKey = process.env.BOT_PRIVATE_KEY!;
const postgresqlUrl = process.env.POSTGRESQL_URL!;
const postgresqlPW = process.env.POSTGRESQL_PW!;
const groupAddress = process.env.GROUP_ADDRESS!;
const groupTokenAddress = process.env.GROUP_TOKEN_ADDRESS!;

async function get_latest_group_members(since: number): Promise<GroupMember[]> {
    // We fetch the latest group members from the database
    return [];
}

async function initializeMembersCache(): Promise<MembersCache> {
    // We fetch the latest members from the database
    const earlyNumber: number = 0;
    var membersCache = {
        Date.now(),
        get_latest_group_members(earlyNumber)
    }   ;
}


async function initializeBot(): Promise<Bot> {
    // at this double check the bot has the required xDAI balance
    return {
        balance: 1000, // xDAI balance, needs to be made available first
        address: botAddress,
        groupTokens: 0, // Group token balance
    };
}


// helper function to redeem as many group tokens for the target member as possible. We return the amount of group tokens redeemed
async function redeemGroupTokens(max_amount: number, target_member: GroupMember): Promise<number> {
    // We redeem the group tokens. 
    return 0;
}

// helper function to get current balance of an account
async function getBalances(address: string): Promise<number> {
    // We fetch the balance using the ethers library
    let balance = await ethers.provider.getBalance(address);
    return balance;
}

// check order status as RPC call
async function getOpenOrders(from: string): Promise<Order[]> {
    // We fetch open orders using the CowSwap Orderbook API
    let orders: Order[] = await OrderBookApi.getOrders(from=from);
    return orders.filter((order) => order.orderStatus === OrderStatus.OPEN);
}
async function mintIndividualTokens() {
    // We first get all the balances that the bot has
    let balances = await getBalances(botAddress);
    await mintFromGroup(balances);
}

async function mintFromGroup(balances: number) {
    // We then mint the individual tokens using the Circles SDK (https://docs.aboutcircles.com/developer-docs/circles-avatars/group-avatars/mint-group-tokens
}

async function pickNextMember(membersCache: MembersCache): Promise<{ member: GroupMember; direction: "toGroup" | "fromGroup" }> {
    // Logic to pick next members using exploration/exploitation trade-off
    return { member: membersCache.members[0], direction: "toGroup" };
}

async function placeLimitOrder(sellAmount: number, buyAmount: number): Promise<string> {
    // Simulate placing a limit order on CowSwap
    return `order_${Date.now()}`;
}

async function main() {
    const membersCache = await initializeMembersCache();
    const bot = await initializeBot();

    while (true) {
        await new Promise((resolve) => setTimeout(resolve, waitingTime));

        // 1. Update open orders
        const openOrders = await getOpenOrders(bot.address)

        if (openOrders.length >= maxOpenOrders) {
            continue;
        }

        // 2. Mint group tokens from bot's balance of trusted collateral        
        await mintIndividualTokens();

        // 3. Pick next members

        const { member, direction } = await pickNextMember(membersCache);

        // 4. Calculate investing amount
        let currentBalance = await getBalances(bot.address)[groupTokenAddress];
        const investingFraction = maxInvestingFraction / Math.max(1, openOrders.length);
        let investingAmount = currentBalance * investingFraction * bufferFraction;

        if (direction === "toGroup") {
            const collateralAmount = (group.collateral.get(member) || 0) * bufferFraction;
            const target_redeemAmount = Math.min(collateralAmount, investingAmount);

            const redeemAmount = await redeemGroupTokens(target_redeemAmount, member);

            if (redeemAmount > 0) {
                // Approve token for trading if required
                if (!member.is_approved) {
                    // We approve the token for trading
                    member.is_approved = true;
                    await approve_member([member]);
                }
                const orderId = await placeLimitOrder(redeemAmount, redeemAmount * (1 - epsilon));
            }
        } else if (direction === "fromGroup") {
            // we simply place a limit order to buy the 
            const orderId = await placeLimitOrder(investingAmount, investingAmount * (1 - epsilon));
        }
    }
}



main().catch(console.error);
