// TypeScript code for the Circles arbitrage bot

import "dotenv/config";
import { log } from "console";
import WebSocket from "ws";
global.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;

// Import ethers v5
import { ethers, Contract } from "ethers";
// Import ethers v6 (aliased in package.json)
// @dev two ethers versions are required as v5 is used by CoWswap sdk and v6 by the Circles sdk
import { ethers as ethers6 } from "ethers6";

import { OrderBookApi, SupportedChainId, OrderSigningUtils, UnsignedOrder, OrderKind, SigningScheme, EnrichedOrder , OrderStatus} from "@cowprotocol/cow-sdk";
import {
    BalancerApi,
    ChainId,
    SwapKind,
    Token,
    TokenAmount,
    Swap,
  } from "@balancer/sdk";
import { Avatar, circlesConfig, Sdk } from "@circles-sdk/sdk";
import { PrivateKeyContractRunner } from "@circles-sdk/adapter-ethers";
import { CirclesData, CirclesRpc, TokenBalanceRow } from '@circles-sdk/data';

import pg from "pg"; // @dev pg is a CommonJS module
const { Client } = pg;

import {
    ArbDirection,
    Bot,
    GroupMember,
    MembersCache,
    PlaceOrderResult,
    NextPick
} from "./interfaces/index.js";

// ABI
import {
    tokenApproveAbi,
    erc20Abi,
    erc1155Abi,
    tokenWrapperAbi
} from "./abi/index.js";

// Algorithm parameters
const epsilon: number = 0.01;
const validityCutoff: number = 60 * 60 * 1000; // 1 hour in ms
const waitingTime: number = 1000; // 1 second
const maxInvestingFraction: number = 0.1;
const bufferFraction: number = 0.95;
const maxOpenOrders: number = 10;
const ratioCutoff: number = 0.1 // this value determines at which point we consider prices to have equilibrated.

// constants 
const cowswapChainId = SupportedChainId.GNOSIS_CHAIN
const chainId = ChainId.GNOSIS_CHAIN;
const rpcUrl = process.env.RPC_URL!;
const botAddress = process.env.ARBBOT_ADDRESS!;
const botPrivateKey = process.env.PRIVATE_KEY!;
const allowanceAmount = ethers.constants.MaxUint256;
const DemurragedVSInflation = 1;

const postgresqlPW = process.env.POSTGRESQL_PW;
const postgresqlUser = "readonly_user";
const postgresqlDB = "circles"; 
const postgressqlHost = "144.76.163.174";
const postgressqlPort = 5432;

const groupAddress = process.env.TEST_GROUP_ADDRESS!;
const groupTokenAddress = process.env.TEST_GROUP_ERC20_TOKEN!;
const CowSwapRelayerAddress = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110";
const tokenWrapperContractAddress = "0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5";

// Initialize relevant objects
const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
const providerV6 = new ethers6.JsonRpcProvider(rpcUrl);

const wallet = new ethers.Wallet(botPrivateKey, provider);
const walletV6 = new PrivateKeyContractRunner(providerV6, botPrivateKey);
const selectedCirclesConfig = circlesConfig[100];
const circlesRPC = new CirclesRpc(selectedCirclesConfig.circlesRpcUrl);
const circlesData = new CirclesData(circlesRPC);

let
    sdk: Sdk | null,
    botAvatar: Avatar | null;

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

// Fetch the latest price for an individual token (in units of the group token)
async function fetchLatestPrice(tokenAddress: string): Promise<bigint | null> {

    const memberToken = new Token(
        chainId,
        tokenAddress as `0x${string}`,
        18,
        "Member Token"
    );

    const swapKind = SwapKind.GivenIn;

    const sorPaths = await balancerApi.sorSwapPaths.fetchSorSwapPaths({
        chainId,
        tokenIn: memberToken.address,
        tokenOut: balancerGroupToken.address,
        swapKind: swapKind,
        swapAmount: TokenAmount.fromHumanAmount(memberToken, "1.0")
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

    // the price of the member token (in units of group tokken) is the inverse of the number of tokens I get out for one grouptoken
    return swap.outputAmount.amount

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
    console.log("Initializing members cache...");

    // We fetch the latest members from the database
    console.log("Fetching latest members...");
    const earlyNumber: number = 0;
    let members = await getLatestGroupMembers(BigInt(earlyNumber));

    // We fetch the token addresses for the members
    console.log("Fetching token addresses...");
    members = await updateGroupMemberTokenAddresses(members);

    // We filter members without wrapped tokens
    members = members.filter((member) => member.token_address !== ethers.constants.AddressZero);

    // We fetch the latest price for the members
    console.log("Fetching latest prices...");
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

async function getBotErc20Balance(tokenAddress: string): Promise<number> {
    
    // Create a contract instance for the token
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);

    // Fetch the balance
    let balance = await tokenContract.balanceOf(botAddress);
    return parseFloat(ethers.utils.formatEther(balance));
}

async function getBotErc1155Balance(tokenAddress: string): Promise<number> {
    // Create a contract instance for the token
    const tokenContract = new ethers.Contract(selectedCirclesConfig.v2HubAddress, erc1155Abi, provider);

    // Fetch the balance
    const balance = await tokenContract.balanceOf(botAddress, ethers.BigNumber.from(tokenAddress));
    return balance.toBigInt();
}

async function getOpenOrders(): Promise<EnrichedOrder[]> {
    // We fetch open orders using the CowSwap Orderbook API
    let orders: EnrichedOrder[] = await orderBookApi.getOrders({ owner: botAddress });
    return orders.filter((order) => order.status === OrderStatus.OPEN);
}

async function mintPossilbeGroupTokens(group: string, membersCache: MembersCache) {
    const botBalances: TokenBalanceRow[] = await circlesData.getTokenBalances(botAddress);
    // Filter tokens to keep tokens of gorup members only and apply some other filters
    const filteredTokens = botBalances.filter(token => {
        // @todo add filter to skip dust amount
        // Only keep version === 2 tokens and skip group tokens
        if (token.version !== 2 || token.isGroup) return false;
      
        // Check if this token's owner matches (case-insensitive) any of the member addresses
        return membersCache?.members.some(member => 
            member.address.toLowerCase() === token.tokenOwner.toLowerCase()
        );
    });

    // unwrap wraped personal tokens to mint as a group token later
    const unwrapQueue = filteredTokens.map(async (token) => {
        if(token.isWrapped) {
            if(token.isInflationary) {
                await botAvatar.unwrapInflationErc20(token.tokenAddress, token.staticAttoCircles);
            } else {
                await botAvatar.unwrapDemurrageErc20(token.tokenAddress, token.staticAttoCircles);
            }
        }
    });
    await Promise.all(unwrapQueue);

    await mintGroupTokensFromIndividualTokens(filteredTokens);
}

async function mintGroupTokensFromIndividualTokens(tokensToMint: TokenBalanceRow[]) {
    // We then mint the group tokens using the Circles SDK (https://docs.aboutcircles.com/developer-docs/circles-avatars/group-avatars/mint-group-tokens
    // @todo filter duplications after unwrap
    const tokenAvatars = tokensToMint.map(token => token.tokenOwner);
    const tokenBalances = tokensToMint.map(token => token.attoCircles);
    if(tokenAvatars.length > 0 && tokenAvatars.length === tokenBalances.length) {
        await botAvatar.groupMint(
            groupAddress,
            tokenAvatars,
            tokenBalances,
            "0x"
        );
    }

    const totalGroupTokensBalance = await getBotErc1155Balance(groupAddress);
    // Wrap Group Tokens into ERC20
    // @todo filter dust amounts
    await botAvatar.wrapInflationErc20(groupAddress, totalGroupTokensBalance);
}


async function pickNextMember(membersCache: MembersCache): Promise<NextPick> {
    // Logic to pick next members using exploration/exploitation trade-off

    // In a first step we filter out members without a price
    let members = membersCache.members.filter((member) => member.latest_price !== null);
    if (members.length === 0) {
        console.log("No members with a price found");
        return null;
    }    

    // For now we use a dummy logic: we pick the member whose token's price is the farthest away from 1. If that is within the cutoff, we do nothing.
    
    // some helpfer functions to let us calculate the ratio of a bigint
    function log10(bigint:bigint) {
        if (bigint < 0) return NaN;
        const s = bigint.toString(10);
        return s.length + Math.log10(parseFloat("0." + s.substring(0, 15)))
      }

    let logdiff = (a: bigint) => Number(Math.abs(log10(a) - 18));
    
    // we sort the members by the highest abs diff function evaluated on the latest value
    let sortedMembers = members.sort((a, b) => logdiff(b.latest_price!) - logdiff(a.latest_price!));
    // we take the first and last member as candidates
    let pickedMember = sortedMembers[0];
    if (logdiff(pickedMember.latest_price!) < ratioCutoff) {
        return null;
    }
    let direction = log10(pickedMember.latest_price!) > 18 ? ArbDirection.REDEEM : ArbDirection.GROUP_MINT;
    return { member: pickedMember, direction: direction};
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

    // Approve the relayer to spend the token fi required
    const current_allowance = await checkAllowance(botAddress, CowSwapRelayerAddress, member.token_address);
    if (Number(current_allowance) < maxSellAmount) {
        console.log("Approving the relayer to spend the token...");
        await approveTokenWithRelayer(member.token_address);
    }

    const sellToken = direction === ArbDirection.REDEEM ? member.token_address : groupTokenAddress;
    const buyToken = direction === ArbDirection.REDEEM ? groupTokenAddress : member.token_address;

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
    await walletV6.init();
    sdk = new Sdk(walletV6, selectedCirclesConfig);
    botAvatar = await sdk.getAvatar(botAddress);

    const membersCache = await initializeMembersCache();
    const bot = await initializeBot();

    let run_while_loop = true;
    while (run_while_loop) {
        await new Promise((resolve) => setTimeout(resolve, waitingTime));

        // 1. Update open orders
        const openOrders = await getOpenOrders()

        if (openOrders.length >= maxOpenOrders) {
            continue;
        }

        // 2. Mint group tokens from bot's balance of trusted collateral        
        // TODO: Run this potentially only once we know the direction of the next trade?
        await mintPossilbeGroupTokens(groupAddress, membersCache);

        // 3. Pick next members

        const nextPick = await pickNextMember(membersCache);

        if (nextPick === null) {
            continue;
        }

        const { member, direction } = nextPick;
        console.log(`Picked member ${member.address} for ${direction} arbitrage`);
        // 4. Calculate investing amount
        let currentBotBalance = await getBotErc20Balance(member.token_address);

        const investingFraction = maxInvestingFraction / Math.max(1, openOrders.length);

        var investingAmount = currentBotBalance * investingFraction * bufferFraction;

        // 5. Redeem group tokens if necessary
        if (direction === ArbDirection.REDEEM) {
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