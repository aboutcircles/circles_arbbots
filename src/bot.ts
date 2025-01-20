// TypeScript code for the Circles arbitrage bot
import { ethers, Contract } from "ethers";
import { OrderBookApi, SupportedChainId, OrderSigningUtils, UnsignedOrder, OrderKind, SigningScheme, EnrichedOrder , OrderStatus} from "@cowprotocol/cow-sdk";
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
    approved_amount: 
}

interface MembersCache {
    lastUpdated: number;
    members: GroupMember[];
}

enum ArbDirection {
    TO_GROUP = "TO_GROUP",
    FROM_GROUP = "FROM_GROUP",
}

// Algorithm parameters
const epsilon: number = 0.01;
const validityCutoff: number = 60 * 60 * 1000; // 1 hour in ms
const waitingTime: number = 1000; // 1 second
const maxInvestingFraction: number = 0.1;
const bufferFraction: number = 0.95;
const maxOpenOrders: number = 10;

// constants loaded from environment variables
const chainId = SupportedChainId.GNOSIS_CHAIN
const rpcUrl = process.env.RPC_URL!;
const botAddress = process.env.BOT_ADDRESS!;
const botPrivateKey = process.env.BOT_PRIVATE_KEY!;
const postgresqlUrl = process.env.POSTGRESQL_URL!;
const postgresqlPW = process.env.POSTGRESQL_PW!;
const groupAddress = process.env.GROUP_ADDRESS!;
const groupTokenAddress = process.env.GROUP_TOKEN_ADDRESS!;
const CowSwapRelayerAddress = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110";

// ABIs
const vaultRelayerApproveAbi = [
    {
        inputs: [
            { name: '_spender', type: 'address' },
            { name: '_value', type: 'uint256' },
        ],
        name: 'approve',
        outputs: [{ type: 'bool' }],
        stateMutability: 'nonpayable',
        type: 'function',
    },
];
const erc20Abi = [
    {
        constant: true,
        inputs: [{ name: "_owner", type: "address" }],
        name: "balanceOf",
        outputs: [{ name: "balance", type: "uint256" }],
        type: "function",
    },
];

// Initialize relevant objects
const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(botPrivateKey, provider);
const orderBookApi = new OrderBookApi({ chainId });


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

async function getBotBalance(tokenAddress: string): Promise<number> {
    
    // Create a contract instance for the token
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);

    // Fetch the balance
    let balance = await tokenContract.balanceOf(botAddress);
    return parseFloat(ethers.utils.formatEther(balance));
}

async function getOpenOrders(): Promise<EnrichedOrder[]> {
    // We fetch open orders using the CowSwap Orderbook API
    let orders: EnrichedOrder[] = await orderBookApi.getOrders({ owner: botAddress });
    return orders.filter((order) => order.status === OrderStatus.OPEN);
}

async function mintIndividualTokens() {
    // We first get all the balances that the bot has
    let balances = await getBalances(botAddress);
    await mintFromGroup(balances);
}

async function mintFromGroup(balances: number) {
    // We then mint the individual tokens using the Circles SDK (https://docs.aboutcircles.com/developer-docs/circles-avatars/group-avatars/mint-group-tokens
}

async function pickNextMember(membersCache: MembersCache): Promise<{ member: GroupMember; direction: ArbDirection }> {
    // Logic to pick next members using exploration/exploitation trade-off
    return { member: membersCache.members[0], direction: ArbDirection.TO_GROUP };
}

// Approve relayer to spend tokens
async function approveTokenWithRelayer(tokenAddress: string): Promise<void> {
    // This function approves the token over maximal amounts for now, since we consider the vaultRelayer to be trustworthy (in light of protection mechanisms on their part)

    const tokenContract = new Contract(tokenAddress, vaultRelayerApproveAbi, wallet);
    const tx = await tokenContract.approve(CowSwapRelayerAddress,ethers.constants.MaxUint256);
    console.log('Approval transaction:', tx);
    await tx.wait();
    console.log('Approval transaction confirmed');
  }

async function placeOrder(maxSellAmount: number, member: GroupMember, direction: ArbDirection, limit: number): Promise<string> {
    // This wrapper places a partially fillable limit order that sells up to [maxSellAmount] of the inToken at a price of [limit] each. 
    // If [direction] is ArbDirection.TO_GROUP, the bot sells member tokens for group tokens. If [direction] is ArbDirection.FROM_GROUP, the bot sells group tokens for member tokens.
    // The function also takes care of the approval with the cowswap vaultrelayer and signing of the order.

    // Approve token for trading if required
    if (direction === ArbDirection.TO_GROUP && !member.is_approved) {
        // We approve the token for trading
        await approveTokenWithRelayer(member.token_address);
        member.is_approved = true;
    }

    const sellToken = direction === ArbDirection.TO_GROUP ? member.token_address : groupTokenAddress;
    const buyToken = direction === ArbDirection.TO_GROUP ? groupTokenAddress : member.token_address;

    const maxBuyAmount = maxSellAmount * limit;

    // Define the order
    const order: UnsignedOrder = {
        sellToken: sellToken,
        buyToken: buyToken,
        sellAmount: maxSellAmount.toString(),
        buyAmount: maxBuyAmount.toString(),
        validTo: validityCutoff, // Order valid for 1 hour
        appData: "0xb48d38f93eaa084033fc5970bf96e559c33c4cdc07d889ab00b4d63f9590739d", // Taken via instructions from API Schema
        feeAmount: "0", // Adjust if necessary
        partiallyFillable: true,
        kind: OrderKind.SELL, // "sell" means you're selling tokenIn for tokenOut
        receiver: botAddress, // Tokens will be sent back to the same address
    };

    console.log("Signing the order...");
    const { signature, signingScheme } = await OrderSigningUtils.signOrder(order, chainId, wallet);

    console.log("Submitting the order to CoW Protocol...");
    try {
        const orderId = await orderBookApi.sendOrder({
            ...order,
            signature,
            from: botAddress,
            appData: "{}",
            signingScheme: signingScheme as unknown as SigningScheme
        });
        console.log(`Order successfully submitted! Order ID: ${orderId}`);
        return orderId;

    } catch (error) {
        console.error("Failed to submit the order:", error);
        //  @TODO: Handle error properly
        return "error";
    }
}

async function main() {
    const membersCache = await initializeMembersCache();
    const bot = await initializeBot();

    while (true) {
        await new Promise((resolve) => setTimeout(resolve, waitingTime));

        // 1. Update open orders
        const openOrders = await getOpenOrders()

        if (openOrders.length >= maxOpenOrders) {
            continue;
        }

        // 2. Mint group tokens from bot's balance of trusted collateral        
        await mintIndividualTokens();

        // 3. Pick next members

        const { member, direction } = await pickNextMember(membersCache);

        // 4. Calculate investing amount
        let currentBotBalance = await getBotBalance(member.token_address);

        const investingFraction = maxInvestingFraction / Math.max(1, openOrders.length);

        var investingAmount = currentBotBalance * investingFraction * bufferFraction;

        // 5. Redeem group tokens if necessary
        if (direction === ArbDirection.TO_GROUP) {
            const collateralAmount = (group.collateral.get(member) || 0) * bufferFraction;
            const target_redeemAmount = Math.min(collateralAmount, investingAmount);

            const redeemAmount = await redeemGroupTokens(target_redeemAmount, member);

            var investingAmount = redeemAmount;
        } 
        
        // 6. Place order
        await placeOrder(
            investingAmount, 
            member,
            direction,
            1-epsilon);        
    }
}



main().catch(console.error);
