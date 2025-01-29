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
    Deal,
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
    liftErc20Abi,
    inflationaryTokenAbi
} from "./abi/index.js";

// Algorithm parameters
const profitThreshold: bigint = 10n; // the minimal per-trade relative profitability that the bot is willing to accept, represented as bigint in steps of the profitThresholdScale
const profitThresholdScale: bigint = 1000n; // the scale of the profit threshold
const validityCutoff: number = 60 * 60; // 1 hour in seconds
const waitingTime: number = 1000; // 1 second
const bufferFraction: number = 0.95;
const maxOpenOrders: number = 10; // added to avoid spamming cowswap with orders
const ratioCutoff: number = 0.1 // this value determines at which point we consider prices to have equilibrated.
const EPSILON = BigInt(1e14);

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
console.log(selectedCirclesConfig)

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
async function fetchBalancerQuote(tokenAddress: string, groupToMember: boolean = true): Promise<Swap | null> {

    const memberToken = new Token(
        chainId,
        tokenAddress as `0x${string}`,
        18,
        "Member Token"
    );

    const inToken = groupToMember ? balancerGroupToken : memberToken;
    const outToken = groupToMember ? memberToken : balancerGroupToken;

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
    console.log(sorPaths.length);
    if (sorPaths.length === 0) {
        return null;
    }

    // Swap object provides useful helpers for re-querying, building call, etc
    const swap = new Swap({
        chainId,
        paths: sorPaths,
        swapKind
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

// @todo At some point this needs to be updated to some subset of new members, etc. 
async function initializeMembersCache(): Promise<MembersCache> {
    console.log("Initializing members cache...");

    // We fetch the latest members from the database
    console.log("Fetching latest members...");
    const earlyNumber: number = 0;
    let members = await getLatestGroupMembers(BigInt(earlyNumber));

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

async function getBotErc1155Balance(tokenAddress: string): Promise<bigint> {
    // Fetch the balance
    const balance = await hubV2Contract.balanceOf(botAddress, ethers.BigNumber.from(tokenAddress));
    return balance.toBigInt();
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

async function swapUsingBalancer(swap: Swap): Promise<ethers.providers.TransactionReceipt> {
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

    //console.log("Swap call data:", callData);

    const groupTokenContract = new Contract(balancerGroupToken.address, erc20Abi, wallet);
    const approveTx = await groupTokenContract.approve(vaultAddress, swap.inputAmount.amount);
    await approveTx.wait();

    const txResponse = await wallet.sendTransaction({to: callData.to, data: callData.callData});
      
    const txReceipt = await txResponse.wait();
    console.log("Swap executed in tx:", txReceipt.transactionHash);

    return txReceipt;

}

async function updateMemberCache(member:GroupMember): Promise<GroupMember> {
    console.log(`Updating member ${member.address}`);
    const tokenWrapperContract = new Contract(tokenWrapperContractAddress, tokenWrapperAbi, wallet);
    // we call the contract 1 by 1 for each address
    
    if(member.token_address === ethers.constants.AddressZero || member.token_address === undefined) {
        const tokenAddress = await tokenWrapperContract.erc20Circles(DemurragedVSInflation, member.address);
        member.token_address = tokenAddress;
    }

    if(member.token_address !== ethers.constants.AddressZero && member.token_address !== undefined) {
        console.log(member.token_address)
        const quote = await fetchBalancerQuote(member.token_address);
        console.log(quote);
        if(quote) member.latest_price = quote!.inputAmount.amount;
        else member.latest_price = BigInt(0);
        member.last_price_update = Date.now();
    }

    return member;
}

async function pickDeal(member: GroupMember): Promise<Deal> {
    console.log(`pickDeal check stated`)
    let isDeal = true;
    let tokenIn = groupTokenAddress;
    let tokenOut = member.token_address;
    let amountIn = member.latest_price ?? BigInt(0);
    let swapData = null;
    const amountOut = BigInt(1e18);
  
    // If there's no price yet or if it's definitely higher than 1e18
    if (amountIn === BigInt(0) || amountIn > BigInt(1e18) + EPSILON) {
        swapData = await fetchBalancerQuote(member.token_address, false);
        amountIn = swapData?.inputAmount.amount ?? BigInt(0);

        // If the updated quote also exceeds 1e18
        if (amountIn > BigInt(1e18) + EPSILON) {
            tokenIn = member.token_address;
            tokenOut = groupTokenAddress;
        }
    } 
    // If it's definitely lower than 1e18
    else if (amountIn < BigInt(1e18) - EPSILON) {
        // we jsut move forward
        swapData = await fetchBalancerQuote(member.token_address);
        
    } 
    // Otherwise, it's within the epsilon range of 1e18
    else {
        isDeal = false;
    }

    // @todo check if enough CRC
  
    return {
        isExecutable: isDeal,
        tokenIn,
        tokenOut,
        amountOut,
        swapData
    };
}

// return true if tokens are converted successfully, or there is enough tokens on the contract
// return false if it it impossible to get these tokens
function sumBalance(balances: TokenBalanceRow[]): bigint {
    return balances.reduce((sum, entry) => {
        return sum + BigInt(entry.staticAttoCircles);
    }, BigInt(0));
}

// @dev `tokenAmount` in static CRC
// @todo fix conversion form static to inflationary
async function requireTokens(tokenAddress: string, tokenAmount: bigint, balances: TokenBalanceRow[]): Promise<boolean> {
    const initialTokenBalance = await getBotErc20Balance(tokenAddress);

    // @todo check compatibility between erc1155 and inflationary amount
    if(initialTokenBalance >= tokenAmount) return true;
    else {
        const lackingAmount = tokenAmount - initialTokenBalance;
        console.log(`Lack some tokens: ${lackingAmount}`);
        // wrapped erc20
        const tokenContract = new Contract(tokenAddress, inflationaryTokenAbi, provider);
        const avatar = await tokenContract.avatar();

        const tokensToWrapBalance = await getBotErc1155Balance(avatar);
        //convertDemurrageToInflationaryValue()
        if(tokensToWrapBalance < lackingAmount){
            console.log(`Some tokens would be missing after wrapping ${lackingAmount - tokensToWrapBalance}`);
            const tokensToMint = lackingAmount - tokensToWrapBalance;

            if(tokenAddress == groupTokenAddress) {
                // sumup members tokens without group tokens
                const membersTokens = balances.filter(balance => balance.tokenOwner != groupAddress);
                const additionalMintableGroupTokens = sumBalance(membersTokens);

                console.log(`Additional mintable group tokens amount ${additionalMintableGroupTokens}`);
                if(additionalMintableGroupTokens < tokensToMint) return false;
                else {
                    // @todo some member tokens needs unwrapping before mint
                    // @todo mint tokensToMint precisely
                    return true;
                }
            } else {
                const maxRedeemableTokensAmount = await getMaxRedeemableAmount(avatar);
                const filteredBalance = balances.filter(balance => balance.tokenOwner != avatar);
                const additionalMintableMemberTokens = sumBalance(filteredBalance);
                // and if we have enough tokens (group tokens + members toekns) to redeem that amount
                if(
                    additionalMintableMemberTokens >= tokensToMint
                    && maxRedeemableTokensAmount >= tokensToMint
                ) {
                    console.log(`We might redeem tokens ${tokensToMint}`)

                    // @todo check if group tokens + other member tokens are enough to redeem
                    return true;
                } else {
                    console.log(`We can't redeem tokens. Tokens to mint ${tokensToMint}, additional mintable amount ${additionalMintableMemberTokens}, MaxRedeemableAmount ${maxRedeemableTokensAmount}`);
                    return false
                }
            }
            // @todo get max possible amount;

            // @todo wrap the minted group or personal tokens
            // @todo finish
        } else {
            // @todo wrap `tokensToWrapBalance` erc1155
            return true;
        }
        // has erc1155
        // might get throw the group
        // may not get from group
    }
}

async function execDeal(deal: Deal): Promise<void> {
    // @todo check the current balance
    console.log(`Executing deal tokenIn: ${deal.tokenIn}, tokenOut: ${deal.tokenOut}`);
    if(deal.swapData) await swapUsingBalancer(deal.swapData);
}
// Main function

async function getBotBalances(members: GroupMember[]): Promise<TokenBalanceRow[]> {
    let botBalances: TokenBalanceRow[] = await circlesData.getTokenBalances(botAddress);
    // @todo filter version 2 tokens
    let memberAddresses = new Set(members.map(m => m.address.toLowerCase()));
    memberAddresses.add(groupAddress);

    const filteredBalances = botBalances.filter(balance =>
        memberAddresses.has(balance.tokenOwner.toLowerCase())
    );
      
    return filteredBalances;
}

async function main() {
    try {
        await walletV6.init();
        sdk = new Sdk(walletV6, selectedCirclesConfig);
        botAvatar = await sdk.getAvatar(botAddress);

        const membersCache = await initializeMembersCache();
        let botBalances = await getBotBalances(membersCache.members);

        while (true) {

                console.log("Loop iteration start");

                for (let i = 0; i < membersCache.members.length; i++) {
                    try {
                        const newMemberState = await updateMemberCache(membersCache.members[i]);
                    
                        if (newMemberState.latest_price) {
                            const deal = await pickDeal(newMemberState);
                            if (deal) {
                                await execDeal(deal);
                            }
                        }
                        
                        membersCache.members[i] = newMemberState;
                    }
                    catch (error) {
                        console.error("Error in main loop iteration:", error);
                        // Optionally, add a delay before restarting the loop
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                }
            } 
    } catch (error) {
        console.error("Error in main function:", error);
        process.exit(1); // Exit with a non-zero code to trigger PM2 restart
    }
}

main().catch(error => {
    console.error("Unhandled error in main function:", error);
    process.exit(1); // Exit with a non-zero code to trigger PM2 restart
});
