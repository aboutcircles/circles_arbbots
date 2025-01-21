// TypeScript code for the Circles arbitrage bot
import { ethers, Contract } from "ethers";
import { OrderBookApi, SupportedChainId, OrderSigningUtils, UnsignedOrder, OrderKind, SigningScheme, EnrichedOrder , OrderStatus} from "@cowprotocol/cow-sdk";
import {
    BalancerApi,
    ChainId,
    Slippage,
    SwapKind,
    Token,
    TokenAmount,
    Swap,
    SwapBuildOutputExactIn,
    SwapBuildCallInput,
    ExactInQueryOutput
  } from "@balancer/sdk";
  
import { Client } from "pg";

import "dotenv/config";


interface Bot {
    balance: number;
    address: string;
    groupTokens: number;
}

interface GroupMember {
    address: string;
    token_address: string;
    latest_price: number | null;
    last_price_update: number;
    is_approved: boolean;
}

interface MembersCache {
    lastUpdated: number;
    members: GroupMember[];
}

enum ArbDirection {
    TO_GROUP = "TO_GROUP",
    FROM_GROUP = "FROM_GROUP",
}

type PlaceOrderResult = 
    | { success: true; orderId: string }
    | { success: false; error: string };

// Algorithm parameters
const epsilon: number = 0.01;
const validityCutoff: number = 60 * 60 * 1000; // 1 hour in ms
const waitingTime: number = 1000; // 1 second
const maxInvestingFraction: number = 0.1;
const bufferFraction: number = 0.95;
const maxOpenOrders: number = 10;

// constants 
const cowswapChainId = SupportedChainId.GNOSIS_CHAIN
const chainId = ChainId.GNOSIS_CHAIN;
const rpcUrl = process.env.RPC_URL!;
const botAddress = process.env.ARBBOT_ADDRESS!;
const botPrivateKey = process.env.PRIVATE_KEY!;
const allowanceAmount = ethers.constants.MaxUint256;
const DemurragedVSInflation = 0;

const postgresqlPW = process.env.POSTGRESQL_PW;
const postgresqlUser = "readonly_user";
const postgresqlDB = "circles"; 
const postgressqlHost = "144.76.163.174";
const postgressqlPort = 5432;

const groupAddress = process.env.TEST_GROUP_ADDRESS!;
const groupTokenAddress = process.env.TEST_GROUP_ERC20_TOKEN!;
const CowSwapRelayerAddress = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110";
const tokenWrapperContractAddress = "0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5";

// ABIs
const tokenApproveAbi = [
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
    {
        constant: true,
        inputs: [
            { name: "_owner", type: "address" },
            { name: "_spender", type: "address" }
        ],
        name: "allowance",
        outputs: [{ name: "remaining", type: "uint256" }],
        type: "function",
    },
];

const tokenWrapperAbi = [{"inputs":[{"internalType":"contract IHubV2","name":"_hub","type":"address"},{"internalType":"contract INameRegistry","name":"_nameRegistry","type":"address"},{"internalType":"address","name":"_masterCopyERC20Demurrage","type":"address"},{"internalType":"address","name":"_masterCopyERC20Inflation","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"uint8","name":"code","type":"uint8"}],"name":"CirclesAmountOverflow","type":"error"},{"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"uint8","name":"","type":"uint8"}],"name":"CirclesErrorAddressUintArgs","type":"error"},{"inputs":[{"internalType":"uint8","name":"","type":"uint8"}],"name":"CirclesErrorNoArgs","type":"error"},{"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"uint8","name":"","type":"uint8"}],"name":"CirclesErrorOneAddressArg","type":"error"},{"inputs":[{"internalType":"uint256","name":"providedId","type":"uint256"},{"internalType":"uint8","name":"code","type":"uint8"}],"name":"CirclesIdMustBeDerivedFromAddress","type":"error"},{"inputs":[{"internalType":"uint256","name":"id","type":"uint256"},{"internalType":"uint8","name":"code","type":"uint8"}],"name":"CirclesInvalidCirclesId","type":"error"},{"inputs":[{"internalType":"uint256","name":"parameter","type":"uint256"},{"internalType":"uint8","name":"code","type":"uint8"}],"name":"CirclesInvalidParameter","type":"error"},{"inputs":[],"name":"CirclesProxyAlreadyInitialized","type":"error"},{"inputs":[{"internalType":"uint8","name":"code","type":"uint8"}],"name":"CirclesReentrancyGuard","type":"error"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"avatar","type":"address"},{"indexed":true,"internalType":"address","name":"erc20Wrapper","type":"address"},{"indexed":false,"internalType":"enum CirclesType","name":"circlesType","type":"uint8"}],"name":"ERC20WrapperDeployed","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"contract Proxy","name":"proxy","type":"address"},{"indexed":false,"internalType":"address","name":"masterCopy","type":"address"}],"name":"ProxyCreation","type":"event"},{"inputs":[],"name":"ERC20_WRAPPER_SETUP_CALLPREFIX","outputs":[{"internalType":"bytes4","name":"","type":"bytes4"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_avatar","type":"address"},{"internalType":"enum CirclesType","name":"_circlesType","type":"uint8"}],"name":"ensureERC20","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"enum CirclesType","name":"","type":"uint8"},{"internalType":"address","name":"","type":"address"}],"name":"erc20Circles","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"hub","outputs":[{"internalType":"contract IHubV2","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"masterCopyERC20Wrapper","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"nameRegistry","outputs":[{"internalType":"contract INameRegistry","name":"","type":"address"}],"stateMutability":"view","type":"function"}];

// Initialize relevant objects
const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(botPrivateKey, provider);
const orderBookApi = new OrderBookApi({ chainId: cowswapChainId });
const balancerApi = new BalancerApi(
    "https://api-v3.balancer.fi/",
    chainId
);
const client = new Client({
    host: postgressqlHost,
    port: postgressqlPort,
    database: postgresqlDB,
    user: postgresqlUser,
    password: postgresqlPW,
});
const balancerGroupToken = new Token(
    chainId,
    groupTokenAddress as `0x${string}`,
    18,
    "Group Token"
);

// Connect the postgresql client
async function connectClient() {
    try {
        await client.connect();
        console.log('Connected to PostgreSQL database');
    } catch (err) {
        console.error('Error connecting to PostgreSQL database', err);
    }
}

connectClient();

// Helper functions

async function getLatestGroupMembers(since: bigint): Promise<GroupMember[]> {
    try {
        const res = await client.query('SELECT "member" AS "address" FROM "V_CrcV2_GroupMemberships" WHERE "group" = $1 AND timestamp > $2', [groupAddress, since]);
        return res.rows as GroupMember[];
    } catch (err) {
        console.error('Error running query', err);
        return [];
   }
}

async function updateGroupMemberTokenAddresses(members: GroupMember[]): Promise<GroupMember[]> {
    const tokenWrapperContract = new ethers.Contract(tokenWrapperContractAddress, tokenWrapperAbi, wallet);
    // we call the contract 1 by 1 for each address
    for (let i = 0; i < members.length; i++) {
        const member = members[i];
        const tokenAddress = await tokenWrapperContract.erc20Circles(DemurragedVSInflation, member.address);
        member.token_address = tokenAddress;
    }
    return members;
}


async function checkAllowance(owner: string, spender: string, tokenAddress: string): Promise<ethers.BigNumber> {
    // Create a contract instance for the token
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);

    // Fetch the allowance
    const allowance = await tokenContract.allowance(owner, spender);
    return allowance
}

async function updateAllowances(members: GroupMember[]): Promise<GroupMember[]> {
    // we call the contract 1 by 1 for each address
    for (let i = 0; i < members.length; i++) {
        const member = members[i];
        const allowance = await checkAllowance(botAddress, CowSwapRelayerAddress, member.token_address);
        
        // We set the is_approved flag based on the allowance
        member.is_approved = allowance.eq(allowanceAmount);
    }
    return members;
}

// Fetch the latest price for an individual token (in units of the group token)
async function fetchLatestPrice(tokenAddress: string): Promise<number | null> {

    const memberToken = new Token(
        chainId,
        tokenAddress as `0x${string}`,
        18,
        "Member Token"
    );

    const swapKind = SwapKind.GivenIn;

    const sorPaths = await balancerApi.sorSwapPaths.fetchSorSwapPaths({
        chainId,
        tokenIn: balancerGroupToken.address,
        tokenOut: memberToken.address,
        swapKind: swapKind,
        swapAmount: TokenAmount.fromHumanAmount(balancerGroupToken, "1.0")
    });

    // if there is no path, we return null
    if (sorPaths.length === 0) {
        return null;
    }

    // Swap object provides useful helpers for re-querying, building call, etc
    const swap = new Swap({
        chainId,
        paths: sorPaths,
        swapKind,
    });

    return Number(swap.outputAmount.amount)
}


async function checkLatestPrices(members: GroupMember[]): Promise<GroupMember[]> {
    // we call the contract 1 by 1 for each address
    for (let i = 0; i < members.length; i++) {
        const member = members[i];
        member.latest_price = await fetchLatestPrice(member.token_address);
        member.last_price_update = Date.now();
    }
    return members;
}

// TODO: At some point this needs to be updated to some subset of new members, etc. 
async function initializeMembersCache(): Promise<MembersCache> {
    // We fetch the latest members from the database
    const earlyNumber: number = 0;
    var members = await getLatestGroupMembers(BigInt(earlyNumber));
    // We fetch the token addresses for the members
    members = await updateGroupMemberTokenAddresses(members);

    // We filter members without wrapped tokens
    members = members.filter((member) => member.token_address !== ethers.constants.AddressZero);

    // We fetch the allowances for the members
    members = await updateAllowances(members);

    // We fetch the latest price for the members
    members = await checkLatestPrices(members);

    console.log(members);
    return {
        lastUpdated: Date.now(),
        members: members,
    };
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
    // let balances = await getBalances(botAddress);
    // await mintFromGroup(balances);
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

    const tokenContract = new Contract(tokenAddress, tokenApproveAbi, wallet);
    const tx = await tokenContract.approve(CowSwapRelayerAddress,allowanceAmount);
    console.log('Approval transaction:', tx);
    await tx.wait();
    console.log('Approval transaction confirmed');
  }

async function placeOrder(maxSellAmount: number, member: GroupMember, direction: ArbDirection, limit: number): Promise<PlaceOrderResult> {
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
    const { signature, signingScheme } = await OrderSigningUtils.signOrder(order, cowswapChainId, wallet);

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
        return {success: true, orderId: orderId};

    } catch (error) {
        console.error("Failed to submit the order:", error);
        let errorMessage = "Unknown error";
        if (error instanceof Error) {
            errorMessage = error.message;
        }
        return { success: false, error: errorMessage };
    }
    }


// Main function

async function main() {
    const membersCache = await initializeMembersCache();
    const bot = await initializeBot();

    let run_while_loop = false;
    while (run_while_loop) {
        await new Promise((resolve) => setTimeout(resolve, waitingTime));

        // 1. Update open orders
        const openOrders = await getOpenOrders()

        if (openOrders.length >= maxOpenOrders) {
            continue;
        }

        // 2. Mint group tokens from bot's balance of trusted collateral        
        // TODO: RUn this potentially only once we know the direction of the next trade?
        await mintIndividualTokens();

        // 3. Pick next members

        const { member, direction } = await pickNextMember(membersCache);

        // 4. Calculate investing amount
        let currentBotBalance = await getBotBalance(member.token_address);

        const investingFraction = maxInvestingFraction / Math.max(1, openOrders.length);

        var investingAmount = currentBotBalance * investingFraction * bufferFraction;

        // 5. Redeem group tokens if necessary
        if (direction === ArbDirection.TO_GROUP) {
            const collateralAmount = 0//(group.collateral.get(member) || 0) * bufferFraction;
            const target_redeemAmount = Math.min(collateralAmount, investingAmount);
            const redeemAmount = await redeemGroupTokens(target_redeemAmount, member);
            investingAmount = redeemAmount;
        } 
        
        // 6. Place order
        placeOrder(
            investingAmount, 
            member,
            direction,
            1-epsilon);        
    }
}



main().catch(console.error);
// console.log(members);