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
    Slippage,
    SwapKind,
    Token,
    TokenAmount,
    Swap,
    SwapBuildOutputExactIn,
    SwapBuildCallInput,
    ExactInQueryOutput
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
    groupTreasuryAbi,
    erc20Abi,
    hubV2Abi,
    superGroupOperatorAbi,
    tokenWrapperAbi,
    liftErc20Abi
} from "./abi/index.js";

// Algorithm parameters
const profitThreshold: bigint = 10n; // the minimal per-trade relative profitability that the bot is willing to accept, represented as bigint in steps of the profitThresholdScale
const profitThresholdScale: bigint = 1000n; // the scale of the profit threshold
const validityCutoff: number = 60 * 60; // 1 hour in seconds
const waitingTime: number = 1000; // 1 second
const bufferFraction: number = 0.95;
const maxOpenOrders: number = 10; // added to avoid spamming cowswap with orders
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
const groupOperatorAddress = process.env.TEST_GROUP_OPERATOR!;
const groupTokenAddress = process.env.TEST_GROUP_ERC20_TOKEN!;
const CowSwapRelayerAddress = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110";
const tokenWrapperContractAddress = "0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5";
const vaultAddress = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

// Initialize relevant objects
const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
const providerV6 = new ethers6.JsonRpcProvider(rpcUrl);

const wallet = new ethers.Wallet(botPrivateKey, provider);
const walletV6 = new PrivateKeyContractRunner(providerV6, botPrivateKey);
const selectedCirclesConfig = circlesConfig[100];
const circlesRPC = new CirclesRpc(selectedCirclesConfig.circlesRpcUrl);
const circlesData = new CirclesData(circlesRPC);

const hubV2Contract = new Contract(selectedCirclesConfig.v2HubAddress, hubV2Abi, wallet);

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
    const tokenWrapperContract = new Contract(tokenWrapperContractAddress, tokenWrapperAbi, wallet);
    // we call the contract 1 by 1 for each address
    for (let i = 0; i < members.length; i++) {
        const member = members[i];
        const tokenAddress = await tokenWrapperContract.erc20Circles(DemurragedVSInflation, member.address);
        member.token_address = tokenAddress;
    }
    return members;
}


async function checkAllowance(owner: string, spender: string, tokenAddress: string): Promise<bigint> {
    // Create a contract instance for the token
    const tokenContract = new Contract(tokenAddress, erc20Abi, provider);

    // Fetch the allowance
    const allowance = await tokenContract.allowance(owner, spender);
    return allowance.toBigInt();
}


// Fetch the latest price for an individual token (in units of the group token)
async function fetchBalancerQuote(tokenAddress: string, groupTomember: boolean = true): Promise<Swap | null> {

    const memberToken = new Token(
        chainId,
        tokenAddress as `0x${string}`,
        18,
        "Member Token"
    );

    const inToken = groupTomember ? balancerGroupToken : memberToken;
    const outToken = groupTomember ? memberToken : balancerGroupToken;

    const swapKind = SwapKind.GivenOut;
    const pathInput = {
        chainId,
        tokenIn: inToken.address,
        tokenOut: outToken.address,
        swapKind: swapKind,
        swapAmount: TokenAmount.fromHumanAmount(outToken, "1.0")
    }
    const sorPaths = await balancerApi.sorSwapPaths.fetchSorSwapPaths(pathInput);
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

    return swap

}

async function checkLatestPrices(members: GroupMember[]): Promise<GroupMember[]> {
    // we call the contract 1 by 1 for each address
    for (let i = 0; i < members.length; i++) {
        const member = members[i];
        const quote = await fetchBalancerQuote(member.token_address);
        member.latest_price = quote!.inputAmount.amount;
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
    // console.log("Fetching latest prices...");
    // members = await checkLatestPrices(members);

    console.log(members);
    return {
        lastUpdated: Date.now(),
        members: members,
    };
}

async function getBotErc20Balance(tokenAddress: string): Promise<bigint> {
    
    // Create a contract instance for the token
    const tokenContract = new Contract(tokenAddress, erc20Abi, provider);

    // Fetch the balance
    let balance = await tokenContract.balanceOf(botAddress);
    return balance.toBigInt();
}

async function getBotErc1155Balance(tokenAddress: string): Promise<number> {
    // Fetch the balance
    const balance = await hubV2Contract.balanceOf(botAddress, ethers.BigNumber.from(tokenAddress));
    return balance.toBigInt();
}

async function getOpenOrders(): Promise<EnrichedOrder[]> {
    // We fetch open orders using the CowSwap Orderbook API
    let orders: EnrichedOrder[] = await orderBookApi.getOrders({ owner: botAddress });
    return orders.filter((order) => order.status === OrderStatus.OPEN);
}

async function mintPossibleGroupTokens(group: string, membersCache: MembersCache, threshold: bigint) {
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

    // Some logic to order the members by increasing value and then mint group tokens starting with the least valuable tokens until we reach the threshold
    // Attention: Need to take care of the case where the have tokens for which we don't yet have a price => in this case we should fetch the price
    // @todo needs to be implemented

    // unwrap wrapped personal tokens to mint as a group token later
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

async function theoreticallyAvailableCRC(avatar: string): Promise<bigint> {
    // check if it's a group or member
    let mintableBalance = await botAvatar.getMintableAmount();
    mintableBalance = ethers.utils.parseEther(mintableBalance.toString()).toBigInt();
    let currentBalance = await botAvatar.getTotalBalance();
    currentBalance = ethers.utils.parseEther(currentBalance.toString()).toBigInt();

    //@todo not all tokens might be from group members
    if(avatar == groupAddress) {
        return currentBalance + mintableBalance;
    } else {
        const liftErc20Contract = new Contract("0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5", liftErc20Abi, wallet);

        const erc20Representation = await liftErc20Contract.erc20Circles(1, avatar);
        // erc1155 tokens
        const botBalanceErc1155 = await hubV2Contract.balanceOf(groupAddress, ethers.BigNumber.from(avatar));
        // erc20 tokens
        const botBalanceErc20 = await getBotErc20Balance(erc20Representation);
        
        const maxVaultRedeemableAmount = await getMaxRedeemableAmount(avatar);

        // Calculate net mintable
        const netMintable = mintableBalance + currentBalance - BigInt(botBalanceErc1155) - botBalanceErc20;

        // Compare and return the appropriate amount
        if (maxVaultRedeemableAmount > netMintable) {
            // effectively mintableBalance + currentBalance
            return mintableBalance + currentBalance;
        } else {
            return BigInt(botBalanceErc1155) + botBalanceErc20 + maxVaultRedeemableAmount;
        }
    }
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


async function pickNextMember(membersCache: MembersCache, openOrders: EnrichedOrder[]): Promise<NextPick> {
    // Logic to pick next members using exploration/exploitation trade-off

    // // In a first step we filter out members without a price
    // let members = membersCache.members.filter((member) => member.latest_price !== null);
    // if (members.length === 0) {
    //     console.log("No members with a price found");
    //     return null;
    // }    

    // // For now we use a dummy logic: we pick the member whose token's price is the farthest away from 1. If that is within the cutoff, we do nothing.
    
    // // some helpfer functions to let us calculate the ratio of a bigint
    // function log10(bigint:bigint) {
    //     if (bigint < 0) return NaN;
    //     const s = bigint.toString(10);
    //     return s.length + Math.log10(parseFloat("0." + s.substring(0, 15)))
    //   }

    // let logdiff = (a: bigint) => Number(Math.abs(log10(a) - 18));
    
    // // we sort the members by the highest abs diff function evaluated on the latest value
    // let sortedMembers = members.sort((a, b) => logdiff(b.latest_price!) - logdiff(a.latest_price!));
    // // we take the first and last member as candidates
    // let pickedMember = sortedMembers[0];
    // if (logdiff(pickedMember.latest_price!) < ratioCutoff) {
    //     return null;
    // }
    // let direction = log10(pickedMember.latest_price!) > 18 ? ArbDirection.REDEEM : ArbDirection.GROUP_MINT;
    // return { member: pickedMember, direction: direction, suggestedAmount: 0n };

    // we filterout the members with open orders
    // @todo: If we don't use cowswap, then there would be no need to filter out members with open orders
    let members = membersCache.members.filter((member) => !openOrders.some(order => order.sellToken === member.token_address));

    //if there are no members left, we return null
    if (members.length === 0) {
        console.log("No members without open orders found");
        return null;
    }

    // Randomly select members for now
    let highestLogProfit = 0n;
    let best_member: GroupMember;
    let best_swap: Swap;
    let best_direction: ArbDirection;

    // we take a number of samples and then pick the best one that doesn't already have an open order
    let NSamples = 10;

    for (let i = 0; i < NSamples; i++) {
        // random member
        let member = membersCache.members[Math.floor(Math.random() * membersCache.members.length)];
    

        // we check at what price we can get a member token
        let swap = await fetchBalancerQuote(member.token_address);
        let direction = ArbDirection.GROUP_MINT;
        if (swap === null) {
            continue;
        }
        // depending on the sign of the swao, we calculate the expected profit
        if (swap.inputAmount.amount > BigInt(10**18)) {
            // in this case the the member token is more valuable than the group token
            // in this case we would sell the member token for group tokens and redeem the group tokens
            // we want to estimate the profit of a deal in which we purchase one group token. 
            // for sake of simplicity, we actually query the swap again in the opposite direction.
            swap = await fetchBalancerQuote(member.token_address, false);
            // we need to estimate the amount of member token that we'd need 
            
            if (swap === null) {
                continue;
            }
            direction = ArbDirection.REDEEM;
        }    

        const expectedProfit = BigInt(10**18) - swap.inputAmount.amount;
        if (expectedProfit > highestLogProfit) {
            highestLogProfit = expectedProfit;
            best_member = member;
            best_swap = swap;
            best_direction = direction
        }
    }

    if (highestLogProfit <= 0n) {
        console.log("No profitable trades found");
        return null
    }   

    return { member: best_member!, direction: best_direction!, swap: best_swap!};

}

async function getMaxRedeemableAmount(memberAddress: string): Promise<bigint> {
    const groupTreasuryAddress = await hubV2Contract.treasuries(groupAddress);
    const groupTreasuryContract = new Contract(groupTreasuryAddress, groupTreasuryAbi, provider);
    const groupVaultAddress = await groupTreasuryContract.vaults(groupAddress);

    const balance = await hubV2Contract.balanceOf(groupVaultAddress, ethers.BigNumber.from(memberAddress));
    return balance.toBigInt();
}

async function redeemGroupTokens(memberAddresses: string[], amounts: bigint[]): Promise<void> {
    if(memberAddresses.length != amounts.length) throw new Error("Mismatch in array lengths: memberAddresses, amounts");

    let tx = await hubV2Contract.setApprovalForAll(groupOperatorAddress, true);
    await tx.wait();
    
    const memberAddressesToBigNumber = memberAddresses.map(memberAddress => ethers.BigNumber.from(memberAddress))
    const superGroupOperatorContract = new Contract(groupOperatorAddress, superGroupOperatorAbi, wallet);
    tx = await superGroupOperatorContract.redeem(groupAddress, memberAddressesToBigNumber, amounts);
    await tx.wait();
}

// Approve relayer to spend tokens
async function approveTokenWithRelayer(tokenAddress: string): Promise<void> {
    // This function approves the token over maximal amounts for now, since we consider the vaultRelayer to be trustworthy (in light of protection mechanisms on their part)
    const tokenContract = new Contract(tokenAddress, erc20Abi, wallet);
    const tx = await tokenContract.approve(CowSwapRelayerAddress,allowanceAmount);
    console.log('Approval transaction:', tx);
    await tx.wait();
    console.log('Approval transaction confirmed');
  }

async function placeOrder(maxSellAmount: bigint, member: GroupMember, direction: ArbDirection): Promise<PlaceOrderResult> {
    // This wrapper places a partially fillable limit order that sells up to [maxSellAmount] of the inToken at a price of [limit] each. 
    // If [direction] is ArbDirection.TO_GROUP, the bot sells member tokens for group tokens. If [direction] is ArbDirection.FROM_GROUP, the bot sells group tokens for member tokens.
    // The function also takes care of the approval with the cowswap vaultrelayer and signing of the order.

    // Approve the relayer to spend the token fi required
    const current_allowance = await checkAllowance(botAddress, CowSwapRelayerAddress, member.token_address);
    if (current_allowance < maxSellAmount) {
        // @todo approve only the outstanding amount
        console.log("Approving the relayer to spend the token...");
        await approveTokenWithRelayer(member.token_address);
    }

    const sellToken = direction === ArbDirection.REDEEM ? member.token_address : groupTokenAddress;
    const buyToken = direction === ArbDirection.REDEEM ? groupTokenAddress : member.token_address;

    // const maxBuyAmount = maxSellAmount * (profitThresholdScale - profitThreshold) / profitThresholdScale;

    // Define the order
    const order: UnsignedOrder = {
        sellToken: sellToken,
        buyToken: buyToken,
        sellAmount: maxSellAmount.toString(),
        buyAmount: BigInt(10**18).toString(),//maxBuyAmount.toString(),
        validTo: Math.floor(Date.now()/1000) + validityCutoff, // Order valid for 1 hour
        appData: "0xb48d38f93eaa084033fc5970bf96e559c33c4cdc07d889ab00b4d63f9590739d", // Taken via instructions from API Schema
        feeAmount: "0", // Adjust if necessary
        partiallyFillable: true,
        kind: OrderKind.SELL, // "sell" means you're selling tokenIn for tokenOut
        receiver: botAddress, // Tokens will be sent back to the same address
    };

    console.log("Order details:", order);

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

async function swapUsingBalancer(tokenAddress: string, swap: Swap): Promise<ethers.providers.TransactionReceipt> {
    console.log(
        `Input token: ${swap.inputAmount.token.address}, Amount: ${swap.inputAmount.amount}`
    );
    console.log(
        `Output token: ${swap.outputAmount.token.address}, Amount: ${swap.outputAmount.amount}`
    );

    // Get up to date swap result by querying onchain
    const updated = await swap.query(rpcUrl) as ExactInQueryOutput;
    console.log(`Updated amount: ${updated.expectedAmountOut}`);

    const wethIsEth = false; // If true, incoming ETH will be wrapped to WETH, otherwise the Vault will pull WETH tokens
    const deadline = 999999999999999999n; // Deadline for the swap, in this case infinite
    const slippage = Slippage.fromPercentage("0.1"); // 0.1%
    

    let buildInput: SwapBuildCallInput;
    
    buildInput = {
        slippage,
        deadline,
        queryOutput: updated,
        wethIsEth,
        sender: botAddress as `0x${string}`,
        recipient: botAddress as `0x${string}`,
    };
    
    const callData = swap.buildCall(buildInput) as SwapBuildOutputExactIn;

    console.log("Swap call data:", callData);

    const groupTokenContract = new Contract(balancerGroupToken.address, erc20Abi, wallet);
    const approveTx = await groupTokenContract.approve(vaultAddress, swap.inputAmount.amount);
    await approveTx.wait();

    const txResponse = await wallet.sendTransaction({to: callData.to, data: callData.callData});
      
    const txReceipt = await txResponse.wait();
    console.log("Swap executed in tx:", txReceipt.transactionHash);

    return txReceipt;

}

// Main function
async function main() {
    await walletV6.init();
    sdk = new Sdk(walletV6, selectedCirclesConfig);
    botAvatar = await sdk.getAvatar(botAddress);

    const membersCache = await initializeMembersCache();

    while (true) {
        await new Promise((resolve) => setTimeout(resolve, waitingTime));

        // 1. Update open orders
        console.log("Fetching open orders...");
        const openOrders = await getOpenOrders()

        if (openOrders.length >= maxOpenOrders) {
            continue;
        }

        // 2. Decide next swap
        console.log("Picking next members...");
        const nextPick = await pickNextMember(membersCache, openOrders);

        if (nextPick === null) {
            continue;
        }

        const { member, direction, swap } = nextPick;

        console.log(`Picked member ${member.address} for ${direction} arbitrage and suggested amount of ${swap.inputAmount.amount}`);

        // 3. Once the swap is clear, we optimise the resources: Overall we try to keep our cards open: We mint/redeem as much as we require
        let targetAmount = swap.inputAmount.amount;

        if (direction === ArbDirection.GROUP_MINT) {
            // if the direction is groupMint and we have less groupTokens than the targetAmount, we mint more group tokens
            const currentGroupBalance = await getBotErc1155Balance(groupAddress);
            const outstandingAmount = targetAmount - BigInt(currentGroupBalance);
            if (currentGroupBalance < targetAmount) {
                console.log("Minting group tokens...");
                // @todo, limit the amount of group tokens we mint and also somehow decide whose member's group tokens we mint
                await mintPossibleGroupTokens(groupAddress, membersCache, outstandingAmount);
            }
        }
        else if (direction === ArbDirection.REDEEM) {
            // if the direciton is redeem and we have less member Circles than the target amount, we try to redeem the remaining amount
            const currentMemberBalance = await getBotErc20Balance(member.token_address);
            let oustandingAmount = targetAmount - currentMemberBalance;
            if (oustandingAmount > 0) {
                console.log("Redeeming group tokens...");
                await redeemGroupTokens([member.address], [oustandingAmount]);
            }
        }
            

        console.log("Minting group tokens...");
        // await mintPossibleGroupTokens(groupAddress, membersCache);

        // 4. Calculate investing amount
        let currentBotGroupBalance = await getBotErc20Balance(groupTokenAddress);

        // retrieve the total open amount from the orders
        const openOrderAmount = openOrders.reduce((acc, order) => {
            return order.sellToken === groupTokenAddress ? acc + BigInt(order.sellAmount) : acc;
        }, 0n);
        let availableBalance = currentBotGroupBalance - openOrderAmount;
        if (availableBalance <= 0) {
            console.log(`Skipping order placement as there is no available balance not already commited to an open order`);
            continue;
        }
        
        // @todo one unaddressed problem is that the amount should also be a function of the current ratio: The closer to 1, the less we should invest due to slippage?
        let investingAmount = swap.inputAmount.amount//suggestedAmount < availableBalance ? suggestedAmount : availableBalance;

        // 5. Redeem group tokens if necessary
        if (direction === ArbDirection.REDEEM) {
            const collateralAmount = 0n // placeholder for now
            const targetRedeemAmount = collateralAmount < availableBalance ? collateralAmount : availableBalance;
            const redeemAmount = await redeemGroupTokens([member.address], [targetRedeemAmount]);
            // investingAmount = redeemAmount;
        } 
        
        if (investingAmount <= 0) {
            console.log(`Skipping order placement as either there is no assets to invest or the price impact is too high.`);
            continue;
        }

        // @Todo: Right now we simply consume the swap, but actually the swap needs to be updated based on the whether we successfully redeemd/minted etc! Not a great solution.
        const balancerTradeRecept = await swapUsingBalancer(member.token_address, swap);

        // 6. Place order
        // placeOrder(
        //     investingAmount, 
        //     member,
        //     direction
        // );        
    }
}

main().catch(console.error);


