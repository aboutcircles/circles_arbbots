// TypeScript code for the Circles arbitrage bot

import "dotenv/config";
import WebSocket from "ws";
global.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;

// Import ethers v5
import { ethers, Contract } from "ethers";
// Import ethers v6 (aliased in package.json)
// @dev two ethers versions are required as v5 is used by CoWswap sdk and v6 by the Circles sdk
import { ethers as ethers6 } from "ethers6";

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
    Bot,
    Deal,
    GroupMember,
    MembersCache,
} from "./interfaces/index.js";

// ABI
import {
    groupTreasuryAbi,
    erc20Abi,
    hubV2Abi,
    erc20LiftAbi,
    superGroupOperatorAbi,
    inflationaryTokenAbi
} from "./abi/index.js";
import { queryObjects } from "v8";

// Algorithm parameters
const EPSILON = BigInt(1e15);
const REQUIRE_PRECISION = BigInt(1e15);

// constants 
const chainId = ChainId.GNOSIS_CHAIN;
const rpcUrl = process.env.RPC_URL!;
const botAddress = process.env.ARBBOT_ADDRESS!;
const botPrivateKey = process.env.PRIVATE_KEY!;
// @dev use ethers v6 big int 
const MAX_ALLOWANCE_AMOUNT = ethers6.MaxUint256;
const DemurragedVSInflation = 1;

const postgresqlPW = process.env.POSTGRESQL_PW;
const postgresqlUser = "readonly_user";
const postgresqlDB = "circles"; 
const postgressqlHost = "144.76.163.174";
const postgressqlPort = 5432;

const groupAddress = process.env.TEST_GROUP_ADDRESS!;
const groupOperatorAddress = process.env.TEST_GROUP_OPERATOR!;
const groupTokenAddress = process.env.TEST_GROUP_ERC20_TOKEN!;
const erc20LiftAddress = process.env.ERC20LIFT_ADDRESS!;
const balancerVaultAddress = process.env.BALANCER_VAULT_ADDRESS!;

// Initialize relevant objects
// @dev For a potential future integration with CoW Swap, we need two versions of Ether, as the
// CoW Swap SDK does not support Ethers v6
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
    arbBot: Bot = {
        address: botAddress,
        groupAddress,
        groupTokenAddress,
        approvedTokens: []
    };

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
//@todo update the naming
const balancerGroupToken = new Token(
    chainId,
    arbBot.groupTokenAddress as `0x${string}`,
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
        const res = await client.query('SELECT "member" AS "address" FROM "V_CrcV2_GroupMemberships" WHERE "group" = $1 AND timestamp > $2', [arbBot.groupAddress, since]);
        return res.rows as GroupMember[];
    } catch (err) {
        console.error('Error running query', err);
        return [];
   }
}

async function checkAllowance(tokenAddress: string, ownerAddress: string, spenderAddress: string): Promise<bigint> {
    // Create a contract instance for the token
    const tokenContract = new Contract(tokenAddress, erc20Abi, provider);

    // Fetch the allowance
    const allowance = await tokenContract.allowance(ownerAddress, spenderAddress);
    return allowance.toBigInt();
}


// Fetch the latest price for an individual token (in units of the group token)
async function fetchBalancerQuote(tokenAddress: string, groupToMember: boolean = true, amonutOut: bigint = BigInt(1e18)) : Promise<Swap | null> {
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
        swapAmount: TokenAmount.fromRawAmount(outToken, amonutOut)
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
        swapKind
    });

    // @dev We attempt to make this call to validate the swap parameters, ensuring we avoid potential errors such as `BAL#305` or other issues related to swap input parameters.
    try {
        await swap.query(rpcUrl) as ExactInQueryOutput;
    } catch (error) {
        console.error(error.shortMessage);
        return null;
    }

    return swap;
}

// @todo At some point this needs to be updated to some subset of new members, etc. 
async function initializeMembersCache(): Promise<MembersCache> {
    console.log("Initializing members cache...");

    // We fetch the latest members from the database
    console.log("Fetching latest members...");
    const earlyNumber: number = 0;
    let members = await getLatestGroupMembers(BigInt(earlyNumber));

    console.log(members);
    return {
        lastUpdated: Date.now(),
        members: members
    };
}

async function getBotErc20Balance(tokenAddress: string): Promise<bigint> {
    // Create a contract instance for the token
    const tokenContract = new Contract(tokenAddress, erc20Abi, provider);

    // Fetch the balance
    let balance = await tokenContract.balanceOf(arbBot.address);
    return balance.toBigInt();
}

async function getBotErc1155Balance(tokenAddress: string): Promise<bigint> {
    // Fetch the balance
    const balance = await hubV2Contract.balanceOf(arbBot.address, ethers.BigNumber.from(tokenAddress));
    return balance.toBigInt();
}

async function mintGroupTokensFromIndividualTokens(tokensToMint: TokenBalanceRow[]) {
    // @todo filter group tokens
    // We then mint the group tokens using the Circles SDK (https://docs.aboutcircles.com/developer-docs/circles-avatars/group-avatars/mint-group-tokens
    // @todo filter duplications after unwrap
    const tokenAvatars = tokensToMint.map(token => token.tokenOwner);
    const tokenBalances = tokensToMint.map(token => token.attoCircles);
    if(tokenAvatars.length > 0 && tokenAvatars.length === tokenBalances.length) {
        await arbBot.avatar.groupMint(
            arbBot.groupAddress,
            tokenAvatars,
            tokenBalances,
            "0x"
        );
    }
    // @todo filter dust amounts
}

async function getMaxRedeemableAmount(memberAddress: string): Promise<bigint> {
    const groupTreasuryAddress = await hubV2Contract.treasuries(arbBot.groupAddress);
    const groupTreasuryContract = new Contract(groupTreasuryAddress, groupTreasuryAbi, provider);
    const groupVaultAddress = await groupTreasuryContract.vaults(arbBot.groupAddress);

    const balance = await hubV2Contract.balanceOf(groupVaultAddress, ethers.BigNumber.from(memberAddress));
    return balance.toBigInt();
}

async function redeemGroupTokens(memberAddresses: string[], amounts: bigint[]): Promise<void> {
    if(memberAddresses.length != amounts.length) throw new Error("Mismatch in array lengths: memberAddresses, amounts");
    // @todo check if it is set and do not call it on every redeem
    let tx = await hubV2Contract.setApprovalForAll(groupOperatorAddress, true);
    await tx.wait();
    
    const memberAddressesToBigNumber = memberAddresses.map(memberAddress => ethers.BigNumber.from(memberAddress))
    const superGroupOperatorContract = new Contract(groupOperatorAddress, superGroupOperatorAbi, wallet);
    tx = await superGroupOperatorContract.redeem(arbBot.groupAddress, memberAddressesToBigNumber, amounts);
    await tx.wait();
}

async function swapUsingBalancer(swap: Swap): Promise<void> {
    console.log(
        `Input token: ${swap.inputAmount.token.address}, Amount: ${swap.inputAmount.amount}`
    );
    console.log(
        `Output token: ${swap.outputAmount.token.address}, Amount: ${swap.outputAmount.amount}`
    );

    // Get up to date swap result by querying onchain
    const updated = await swap.query(rpcUrl) as ExactInQueryOutput;

    const wethIsEth = false; // If true, incoming ETH will be wrapped to WETH, otherwise the Vault will pull WETH tokens
    const deadline = 999999999999999999n; // Deadline for the swap, in this case infinite
    const slippage = Slippage.fromPercentage("0.1"); // 0.1%
    

    let buildInput: SwapBuildCallInput;
    
    buildInput = {
        slippage,
        deadline,
        queryOutput: updated,
        wethIsEth,
        sender: arbBot.address as `0x${string}`,
        recipient: arbBot.address as `0x${string}`,
    };
    
    const callData = swap.buildCall(buildInput) as SwapBuildOutputExactIn;

    try {
        const txResponse = await wallet.sendTransaction({to: callData.to, data: callData.callData});
        const txReceipt = await txResponse.wait();
        console.log("Swap executed in tx:", txReceipt.transactionHash);
    } catch (error) {
        // @todo write to error log
        console.error("!!! Transaction failed !!!");
    }    
}

async function updateMemberCache(member:GroupMember): Promise<GroupMember> {
    console.log(`Updating member ${member.address}`);
    const tokenWrapperContract = new Contract(erc20LiftAddress, erc20LiftAbi, wallet);
    // we call the contract 1 by 1 for each address
    
    if(member.tokenAddress === ethers.constants.AddressZero || member.tokenAddress === undefined) {
        const tokenAddress = await tokenWrapperContract.erc20Circles(DemurragedVSInflation, member.address);
        member.tokenAddress = tokenAddress;
    }

    if(member.tokenAddress !== ethers.constants.AddressZero && member.tokenAddress !== undefined) {
        const quote = await fetchBalancerQuote(member.tokenAddress);
        if(quote) member.latestPrice = quote!.inputAmount.amount;
        else member.latestPrice = BigInt(0);
        member.lastPriceUpdate = Date.now();
    }

    return member;
}

async function amountOutGuesser(tokenAddress: string, direction: boolean = true, prevPrice: bigint = BigInt(0), amountOut: bigint = BigInt(1e18)): Promise<[bigint, Swap | null]> {
    console.log("Checking the best `amountOut`")
    const expectedAttempts = 100;
    const requiredToken = direction ? tokenAddress : arbBot.groupTokenAddress;
    let swapData = null;

    for(let i = expectedAttempts; i > 0; i--) {
        const quote = await fetchBalancerQuote(tokenAddress, direction, amountOut * BigInt(2));
        const nextPrice = quote?.inputAmount.amount || BigInt(0);

        if(prevPrice < nextPrice && amountOut > nextPrice) {
            const isExecutable = await requireTokens(requiredToken, nextPrice);

            if(isExecutable) {
                amountOut *= BigInt(2);
                prevPrice = nextPrice;
                swapData = quote;
            } else break;
        } else break;
    }

    return [amountOut, swapData];
}

async function pickDeal(memberIndex: number, groupMembers: GroupMember[]): Promise<Deal> {
    const member = groupMembers[memberIndex];
    let isProfitable = true;
    let isExecutable = false;
    let tokenIn = arbBot.groupTokenAddress;
    let tokenOut = member.tokenAddress;
    let amountIn = member.latestPrice ?? BigInt(0);
    let direction = true;
    let swapData = null;
    let amountOut = BigInt(1e18);
  
    // If there's no price yet or if it's definitely higher than 1e18
    if (amountIn === BigInt(0) || amountIn > BigInt(1e18) + EPSILON) {
        direction = false;
        swapData = await fetchBalancerQuote(member.tokenAddress, direction);
        amountIn = swapData?.inputAmount.amount ?? BigInt(0);

        // If the updated quote also exceeds 1e18
        if (amountIn > BigInt(1e18) + EPSILON) {
            tokenIn = member.tokenAddress;
            tokenOut = arbBot.groupTokenAddress;
        }
    } 
    // If it's definitely lower than 1e18
    else if (amountIn < BigInt(1e18) - EPSILON) {
        // we jsut move forward
        swapData = await fetchBalancerQuote(member.tokenAddress, direction);
        
    } 
    // Otherwise, it's within the epsilon range of 1e18
    else {
        isProfitable = false;
    }
    
    // check if bot has enough required CRC for the swap operation
    // find optimal `amountOut`
    if(isProfitable) {
        // @todo separate redeem/mint token functionality from the check if the deal is potentially executable
        isExecutable = await requireTokens(tokenIn, amountIn);

        if(isExecutable) {
            // @todo replace output with object
            let newSwapData;
            [amountOut, newSwapData] = await amountOutGuesser(member.tokenAddress, direction, amountIn);
            if(newSwapData) swapData = newSwapData;
        }
    }

    return {
        isProfitable: isProfitable && isExecutable,
        tokenIn,
        tokenOut,
        amountOut,
        swapData
    };
}

// return true if tokens are converted successfully, or there is enough tokens on the contract
// return false if it it impossible to get these tokens
function sumBalance(balances: TokenBalanceRow[], isStatic: boolean = true): bigint {
    return balances.reduce((sum, entry) => {
        return isStatic ? sum + BigInt(entry.staticAttoCircles) : sum + BigInt(entry.attoCircles);
    }, BigInt(0));
}

// Helper to select enough tokens until we reach `tokensNeeded`
function gatherTokens(balances: TokenBalanceRow[], tokensNeeded: bigint): TokenBalanceRow[] {
    let accumulatedAmount = BigInt(0);
    const selected: TokenBalanceRow[] = [];
    for (const b of balances) {
        // Stop if we've met or exceeded the requirement
        if (accumulatedAmount >= tokensNeeded) break;
        accumulatedAmount += BigInt(b.staticAttoCircles);
        selected.push(b);
    }
    return selected;
}
  
// Helper that unwraps a list of token balances
async function unwrapTokenList(tokenList: TokenBalanceRow[]) {
    console.log("Tokens unwrapping");
    const unwrappingQueue = tokenList.map(async (token) => {
        if (token.isInflationary && token.isErc20) {
            await arbBot.avatar.unwrapInflationErc20(token.tokenAddress, token.staticAttoCircles);
        } else if (token.isErc20) {
            await arbBot.avatar.unwrapDemurrageErc20(token.tokenAddress, token.staticAttoCircles);
        }
    });
    await Promise.all(unwrappingQueue);
}
  
/**
 * Mint group tokens from members' balances.  
 * Returns `true` if mint succeeded, `false` otherwise.
 */
async function mintIfPossibleFromMembers(
    tokensToMint: bigint,
    balances: TokenBalanceRow[]
): Promise<boolean> {
    // 1. Sum up members' tokens (exclude group address balances)
    const membersTokens = balances.filter(balance => balance.tokenOwner !== arbBot.groupAddress);
    const additionalMintableGroupTokens = sumBalance(membersTokens);
  
    // 2. Check if there's enough
    if (additionalMintableGroupTokens < tokensToMint) {
        return false;
    }
  
    // 3. Gather enough from members
    const utilizableBalances = gatherTokens(membersTokens, tokensToMint);
  
    // 4. Unwrap them
    await unwrapTokenList(utilizableBalances);
  
    // 5. Mint from those unwrapped tokens
    console.log("Group tokens mint started");
    await mintGroupTokensFromIndividualTokens(utilizableBalances);
  
    return true;
}
  
/**
 * Mint group tokens from others' balances, then redeem to get inflationary tokens.  
 * Returns `true` if all steps succeeded, `false` otherwise.
 */
async function mintIfPossibleFromOthers(
    tokensToMint: bigint,
    balances: TokenBalanceRow[],
    avatar: string,
    tokenAddress: string
): Promise<boolean> {
    const maxRedeemableTokensAmount = await getMaxRedeemableAmount(avatar);
    const filteredBalances = balances.filter(balance => balance.tokenOwner !== avatar);
    const additionalMintableTokens = sumBalance(filteredBalances);
  
    // Check if we have enough to redeem
    if (additionalMintableTokens < tokensToMint || maxRedeemableTokensAmount < tokensToMint) {
        return false;
    }
  
    // Gather enough tokens
    const utilizableBalances = gatherTokens(filteredBalances, tokensToMint);
  
    // Unwrap them
    await unwrapTokenList(utilizableBalances);
  
    // Some flows exclude group-owned tokens before mint:
    const filteredGroupTokens = utilizableBalances.filter(token => token.tokenOwner !== arbBot.groupAddress);
  
    console.log("Group tokens mint");
    await mintGroupTokensFromIndividualTokens(filteredGroupTokens);
  
    console.log("Group tokens redeem");
    const demurrageValue = await convertInflationaryToDemurrage(tokenAddress, tokensToMint);
    await redeemGroupTokens([avatar], [demurrageValue]);
  
    return true;
}

// @dev `tokenAmount` specified in static CRC
async function requireTokens(tokenAddress: string, tokenAmount: bigint): Promise<boolean> {
    // @todo get current Bot balances
    
    let balances;
    if(arbBot?.groupMembersCache)
        balances = await getBotBalances(arbBot.groupMembersCache.members);

    // @todo check if token is from member
    console.log(`Checking required tokens ${tokenAddress} ${tokenAmount}`);
    // @dev require a bit more tokens to avoid precision issues
    tokenAmount += REQUIRE_PRECISION;
  
    // Current bot's balance
    // @todo replace with the balances array check
    const initialTokenBalance = await getBotErc20Balance(tokenAddress);
    if (initialTokenBalance >= tokenAmount) {
        return true;
    }
  
    // We don't have enough in the Bot's balance
    const lackingAmount = tokenAmount - initialTokenBalance;
  
    // Check how many tokens we already have in "wrappable" form
    const inflationaryTokenContract = new Contract(tokenAddress, inflationaryTokenAbi, provider);
    const avatar = await inflationaryTokenContract.avatar();
  
    const staticBalance = balances.filter(
        balance => avatar.toLowerCase() === balance.tokenOwner && balance.isErc1155 === true
    );
    let tokensToWrapBalance = BigInt(0);
    if (staticBalance.length) {
        tokensToWrapBalance = BigInt(staticBalance[0].staticAttoCircles);
    }
  
    // If we can't wrap enough from what's already allocated, we need to mint more
    if (tokensToWrapBalance < lackingAmount) {
        const tokensToMint = lackingAmount - tokensToWrapBalance;

        let mintSucceeded = false;
        if (tokenAddress === arbBot.groupTokenAddress) {
            // Mint from members (excluding group address)
            mintSucceeded = await mintIfPossibleFromMembers(tokensToMint, balances);
        } else {
            // Mint + redeem flow
            mintSucceeded = await mintIfPossibleFromOthers(tokensToMint, balances, avatar, tokenAddress);
        }
        if (!mintSucceeded) {
            return false;
        }
    }
  
    // By now, we should have enough tokens to wrap.  
    // Convert to 'demurrage' amount just shy of original packaging to avoid overshoot due to precision issues.
    const convertedAmount = await convertInflationaryToDemurrage(tokenAddress, lackingAmount - REQUIRE_PRECISION);
  
    console.log("Wrapping tokens");
    await arbBot.avatar.wrapInflationErc20(avatar, convertedAmount);
  
    return true;
}
  

async function convertInflationaryToDemurrage(tokenAddress: string, amount: bigint): Promise<bigint> {
    // @todo replace with a single view endpoint onchain
    const inflationaryTokenContract = new Contract(tokenAddress, inflationaryTokenAbi, wallet);
    const days = await inflationaryTokenContract.day((await provider.getBlock('latest')).timestamp)
    const demurrageValue = await inflationaryTokenContract.convertInflationaryToDemurrageValue(amount, days);

    return demurrageValue.toBigInt();
}

// @dev sort according to the order [group token erc1155 balance, group erc20 balance, ...other balances in DESC order by `staticAttoCircles`
function sortBalances(balances: TokenBalanceRow[]): TokenBalanceRow[] {
    return balances.sort((a, b) => {
        // Check if the tokenOwner is a groupAddress and isErc1155
        const aIsErc1155 = a.tokenOwner === arbBot.groupAddress && a.isErc1155;
        const bIsErc1155 = b.tokenOwner === arbBot.groupAddress && b.isErc1155;

        // Check if the tokenOwner is a groupAddress and isInflationary
        const aIsInflationary = a.tokenOwner === arbBot.groupAddress && a.isInflationary;
        const bIsInflationary = b.tokenOwner === arbBot.groupAddress && b.isInflationary;

        // Prioritize items with tokenOwner equal to groupAddress and isErc1155
        if (aIsErc1155 && !bIsErc1155) return -1;
        if (!aIsErc1155 && bIsErc1155) return 1;

        // Prioritize items with tokenOwner equal to groupAddress and isInflationary
        if (aIsInflationary && !bIsInflationary) return -1;
        if (!aIsInflationary && bIsInflationary) return 1;

        // Sort the rest in DESC order by staticAttoCircles
        const result = BigInt(b.staticAttoCircles) - BigInt(a.staticAttoCircles);

        if (result > BigInt(0)) {
            return 1;
        } else if (result < BigInt(0)){
            return -1;
        } else {
            return 0;
        }
    });
}

async function approveTokens(tokenAddress: string, operatorAddress: string, amount: bigint = MAX_ALLOWANCE_AMOUNT) {
    const groupTokenContract = new Contract(tokenAddress, erc20Abi, wallet);
    const approveTx = await groupTokenContract.approve(operatorAddress, amount);
    await approveTx.wait();
}

async function execDeal(deal: Deal, member: GroupMember): Promise<void> {
    // @todo check the current balance
    if(deal.swapData) {
        const tokenAddressToApprove = deal.swapData.inputAmount.token.address;
        // set max allowance if it is not set
        if(!arbBot.approvedTokens.includes(tokenAddressToApprove)) {
            const currentAllowance = await checkAllowance(tokenAddressToApprove, arbBot.address, balancerVaultAddress)
            if (currentAllowance != MAX_ALLOWANCE_AMOUNT)
                await approveTokens(tokenAddressToApprove, balancerVaultAddress);
            // Add prroved tokens to the list
            arbBot.approvedTokens.push(tokenAddressToApprove);
        }
        // execute swap
        await swapUsingBalancer(deal.swapData);
    }
}
// Main function

async function getBotBalances(members: GroupMember[]): Promise<TokenBalanceRow[]> {
    let botBalances: TokenBalanceRow[] = await circlesData.getTokenBalances(arbBot.address);
    // @todo add filter version 2 tokens
    let memberAddresses = new Set(members.map(m => m.address.toLowerCase()));
    memberAddresses.add(arbBot.groupAddress);

    const filteredBalances = botBalances.filter(balance =>
        memberAddresses.has(balance.tokenOwner.toLowerCase())
    );
      
    return sortBalances(filteredBalances);
}

async function main() {
    await walletV6.init();
    sdk = new Sdk(walletV6, selectedCirclesConfig);
    const botAvatar = await sdk.getAvatar(arbBot.address);
    const membersCache = await initializeMembersCache();
    arbBot = {
        ...arbBot,
        avatar: botAvatar,
        groupMembersCache: membersCache
    };

    

    //const result = await amountOutGuesser("0xfa771dd0237e80c22ab8fbfd98c1904663b46e36");
    //console.log(`Optimal swap for the token "0xfa771dd0237e80c22ab8fbfd98c1904663b46e36" amountOut: ${result[0]}`);
    //console.log(result[1])

    while(true) {
        // @todo optimize the logic of updating the members list 
        
        console.log("Loop iteration start");

        for(let i = 0; i < membersCache.members.length; i++) {
            // @todo prettify
            try {
                await updateMemberCache(membersCache.members[i]);

                if (membersCache.members[i].latestPrice) {
                    const deal = await pickDeal(i, membersCache.members);

                    if(deal.isProfitable) {
                        console.log("Start Swap exec", deal)
                        // @todo check batch swaps
                        await execDeal(deal, membersCache.members[i]);
                    }
                }
            } catch (error) {
                console.error("Error in main loop iteration:", error);
                // Optionally, add a delay before restarting the loop
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
        // @todo update membersCache with new members
        // @todo write some logic to clear the dust amounts of CRC
    }
}

main().catch(error => {
    console.error("Unhandled error in main function:", error);
    process.exit(1); // Exit with a non-zero code to trigger PM2 restart
});
