// TypeScript code for the Circles arbitrage bot

import "dotenv/config";
import WebSocket from "ws";
global.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;

// Import ethers v6
import { ethers, Contract, Wallet } from "ethers";

import {
    BalancerApi,
    ChainId,
    Slippage,
    SwapKind,
    Token,
    TokenAmount,
    Swap,
    SwapBuildOutputExactOut,
    SwapBuildCallInput,
    ExactInQueryOutput
} from "@balancer/sdk";

import { circlesConfig, Sdk } from "@circles-sdk/sdk";
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

// Algorithm parameters
const EPSILON = BigInt(1e16);
const REQUIRE_PRECISION = BigInt(1e15);
const MIN_EXTRACTABLE_AMOUNT = BigInt(1e18);

// constants 
const chainId = ChainId.GNOSIS_CHAIN;
const rpcUrl = process.env.RPC_URL!;
const botAddress = process.env.ARBBOT_ADDRESS!;
const botPrivateKey = process.env.PRIVATE_KEY!;
const EXECUTION_PAUSE = 60000; // 1 minute
// @dev use ethers v6 big int 
const MAX_ALLOWANCE_AMOUNT = ethers.MaxUint256;
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
const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new Wallet(botPrivateKey, provider);
const selectedCirclesConfig = circlesConfig[100];
const circlesRPC = new CirclesRpc(selectedCirclesConfig.circlesRpcUrl);
const circlesData = new CirclesData(circlesRPC);
const hubV2Contract = new Contract(selectedCirclesConfig.v2HubAddress, hubV2Abi, wallet);

let
    arbBot: Bot = {
        address: botAddress,
        groupAddress,
        groupTokenAddress,
        approvedTokens: [],
        groupMembersCache: {
            lastUpdated: 0,
            members: []
        }
    },
    sdk: Sdk | null;

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
    await client.connect().then(() => {
        console.log("Connected to PostgreSQL database");
    }).catch((err) => {
        console.error("Error connecting to PostgreSQL database", err);
    });
}

connectClient();

// Helper functions
async function getLatestGroupMembers(since: number): Promise<GroupMember[]> {
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
    return allowance;
}

// Fetch the latest price for an individual token (in units of the group token)
async function fetchBalancerQuote(tokenAddress: string, groupToMember: boolean = true, amountOut: bigint = MIN_EXTRACTABLE_AMOUNT) : Promise<Swap | null> {
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
        swapAmount: TokenAmount.fromRawAmount(outToken, amountOut)
    }

    const sorPaths = await balancerApi.sorSwapPaths.fetchSorSwapPaths(pathInput).catch(() => {
        console.error("ERROR: Path not found")
    });
    // if there is no path, we return null
    if (!sorPaths || sorPaths.length === 0) {
        return null;
    }
    // Swap object provides useful helpers for re-querying, building call, etc
    const swap = new Swap({
        chainId,
        paths: sorPaths,
        swapKind
    });

    // @dev We attempt to make this call to validate the swap parameters, ensuring we avoid potential errors such as `BAL#305` or other issues related to swap input parameters.
    await swap.query(rpcUrl).catch((error: any) => {
        console.error(error?.shortMessage);
        return null;
    });

    return swap;
}

// @todo At some point this needs to be updated to some subset of new members, etc. 
async function updateMembersCache(membersCache: MembersCache) {
    console.log("Updating members cache...");

    // We fetch the latest members from the database
    console.log("Fetching latest members...");
    const newMembers = await getLatestGroupMembers(membersCache.lastUpdated);

    membersCache.members.push(...newMembers);
    membersCache.lastUpdated = Math.floor(Date.now() / 1000);

}

async function getBotErc20Balance(tokenAddress: string): Promise<bigint> {
    // Create a contract instance for the token
    const tokenContract = new Contract(tokenAddress, erc20Abi, provider);

    // Fetch the balance
    let balance = await tokenContract.balanceOf(arbBot.address);
    return balance;
}

async function mintGroupTokensFromIndividualTokens(tokensToMint: TokenBalanceRow[]) {
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

    const balance = await hubV2Contract.balanceOf(groupVaultAddress, BigInt(memberAddress));
    return balance;
}

async function redeemGroupTokens(memberAddresses: string[], amounts: bigint[]): Promise<void> {
    if(memberAddresses.length != amounts.length) throw new Error("Mismatch in array lengths: memberAddresses, amounts");
    // @todo check if it is set and do not call it on every redeem
    let tx = await hubV2Contract.setApprovalForAll(groupOperatorAddress, true);
    await tx.wait();
    
    const memberAddressesToBigNumber = memberAddresses.map(memberAddress => BigInt(memberAddress))
    const superGroupOperatorContract = new Contract(groupOperatorAddress, superGroupOperatorAbi, wallet);
    tx = await superGroupOperatorContract.redeem(arbBot.groupAddress, memberAddressesToBigNumber, amounts);
    await tx.wait();
}

async function swapUsingBalancer(swap: Swap): Promise<boolean> {

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
    
    const callData = swap.buildCall(buildInput) as SwapBuildOutputExactOut;

    // @dev the last check to make sure that the amountIn is smaller than amountOut - epsilon
    if (callData.maxAmountIn.amount > swap.outputAmount.amount - EPSILON) return false;

    console.log(
        `
        Input token: ${swap.inputAmount.token.address}, amountIn: ${callData.maxAmountIn.amount}
        Output token: ${swap.outputAmount.token.address}, amountOut: ${swap.outputAmount.amount}
        `
    );

    return await wallet.sendTransaction({to: callData.to, data: callData.callData})
        .then((txResponse) => {
            console.log("Swap tx:", txResponse?.hash);

            return !!txResponse?.hash;
        }).catch(async () => {
            console.error("!!! Transaction failed !!!");
            // @notice if tx fails we check if we have enough required tokens, 
            // the `swap.inputAmount.amount` and `callData.maxAmountIn.amount` values might differ significantly
            if(callData.maxAmountIn.amount > swap.inputAmount.amount) {
                await requireTokens(swap.inputAmount.token.address, callData.maxAmountIn.amount);
            }

            return false;
        });
}
 
async function updateMemberCache(member:GroupMember): Promise<GroupMember> {
    console.log(`Updating member ${member.address}`);
    const tokenWrapperContract = new Contract(erc20LiftAddress, erc20LiftAbi, wallet);
    // we call the contract 1 by 1 for each address
    
    if(member.tokenAddress === ethers.ZeroAddress || !member.tokenAddress) {
        const tokenAddress = await tokenWrapperContract.erc20Circles(DemurragedVSInflation, member.address);
        member.tokenAddress = tokenAddress;
    }

    if(member.tokenAddress !== ethers.ZeroAddress && member.tokenAddress) {
        const quote = await fetchBalancerQuote(member.tokenAddress);
        if(quote) member.latestPrice = quote!.inputAmount.amount;
        member.latestPrice = quote ? quote.inputAmount.amount : 0n;
        member.lastPriceUpdate = Math.floor(Date.now() / 1000);
    }

    return member;
}

/**
 * @notice Guesses the optimal swap parameters by progressively increasing the proposed output amount.
 * @param tokenAddress The address of the token for which the swap quote is being fetched.
 * @param direction A boolean indicating the swap direction. If true, the swap is from the token to the group token; if false, vice versa.
 * @param currentPrice The current best input price (in terms of token amount) observed.
 * @param currentAmountOut The current output amount used as the baseline for proposing higher output amounts.
 * @return A Promise that resolves to the best Swap object found that meets the profitability criteria, or null if no improvement is found.
 */
async function amountOutGuesser(
    tokenAddress: string,
    direction: boolean = true,
    currentPrice: bigint = BigInt(0),
    currentAmountOut: bigint = MIN_EXTRACTABLE_AMOUNT
  ): Promise<Swap | null> {
    const maxAttempts = 100;
    const requiredToken = direction ? tokenAddress : arbBot.groupTokenAddress;
    let bestSwapData: Swap | null = null;
    let prevProfit = BigInt(0);

    for(let i = 0; i < maxAttempts; i++) {
        // Propose a new amount by doubling the current amount out.
        const proposedAmountOut = currentAmountOut * 2n;
        const quote = await fetchBalancerQuote(tokenAddress, direction, proposedAmountOut);
        const nextPrice = quote?.inputAmount.amount ?? BigInt(0);

        if(currentPrice < nextPrice) {
            const isExecutable = await requireTokens(requiredToken, nextPrice);

            if(isExecutable && nextPrice + EPSILON < proposedAmountOut) {
                currentAmountOut = proposedAmountOut;
                currentPrice = nextPrice;
                // @notice Check if the absolute profit has improved.
                if(prevProfit < proposedAmountOut - nextPrice) {
                    bestSwapData = quote;
                    prevProfit = proposedAmountOut - nextPrice;
                }
            } else break; // Stop if tokens cannot be acquired.
        } else break; // Exit if no improvement is found.
    }

    return bestSwapData;
}  

/**
 * @notice Picks a potential arbitrage deal for a given group member by evaluating swap profitability and executability.
 * @param memberIndex The index of the member in the group members array to evaluate.
 * @param groupMembers An array of group members containing pricing and token information.
 * @return A Promise that resolves to a Deal object containing a flag for profitability/executability and the associated swap data.
 */
async function pickDeal(memberIndex: number, groupMembers: GroupMember[]): Promise<Deal> {
    const member = groupMembers[memberIndex];
    let isProfitable = true;
    let isExecutable = false;
    let tokenIn = arbBot.groupTokenAddress;
    let amountIn = member.latestPrice ?? BigInt(0);
    let direction = true;
    let swapData = null;
    let amountOut = MIN_EXTRACTABLE_AMOUNT;
  
    // If there's no price yet or if it's higher than the minimum threshold plus precision allowance
    if (amountIn === BigInt(0) || amountIn > MIN_EXTRACTABLE_AMOUNT + EPSILON) {
        direction = false;
        swapData = await fetchBalancerQuote(member.tokenAddress, direction);
        amountIn = swapData?.inputAmount.amount ?? BigInt(0);
        amountOut = swapData?.outputAmount.amount ?? BigInt(0);

        if (amountIn === BigInt(0) || amountIn > amountOut - EPSILON ) {
            isProfitable = false;
        }
    } 
    // If the price is lower than the minimum threshold
    else if (amountIn < MIN_EXTRACTABLE_AMOUNT - EPSILON) {
        // Proceed with fetching the swap quote in the default direction
        swapData = await fetchBalancerQuote(member.tokenAddress, direction);
    }    
    
    // Check if the bot has enough tokens to execute the swap
    if(isProfitable) {
        // @todo: Separate redeem/mint token functionality from the executability check
        isExecutable = await requireTokens(tokenIn, amountIn);

        if(isExecutable) {
            const recommendedSwapData = await amountOutGuesser(member.tokenAddress, direction, amountIn);
            swapData = recommendedSwapData ?? swapData;
        }
    }

    amountIn = swapData?.inputAmount.amount ?? BigInt(0);
    amountOut = swapData?.outputAmount.amount ?? BigInt(0);

    if(amountIn >= amountOut - EPSILON) isProfitable = false;
    return {
        isProfitable: isProfitable && isExecutable,
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

/**
 * @notice Ensures that the bot has the required amount of tokens for a swap operation.
 *         If the current balance is insufficient, attempts to mint or redeem additional tokens.
 * @param tokenAddress The address of the token required.
 * @param tokenAmount The total token amount required (expressed as a bigint).
 * @return A Promise that resolves to true if the required tokens are available or can be acquired, false otherwise.
 */
async function requireTokens(tokenAddress: string, tokenAmount: bigint): Promise<boolean> {
    if (!arbBot.groupMembersCache) return false;
    const balances = await getBotBalances(arbBot.groupMembersCache.members);

    if(!balances) return false;

    // @todo check if token is from member
    // Increase the token amount slightly to account for precision issues.
    tokenAmount += REQUIRE_PRECISION;

    // @todo replace with the balances array check
    // Get the current token balance for the bot.
    const initialTokenBalance = await getBotErc20Balance(tokenAddress);
    if (initialTokenBalance >= tokenAmount) {
        return true;
    }
  
    // Calculate the lacking amount.
    const lackingAmount = tokenAmount - initialTokenBalance;
  
    // Retrieve the bot's balance in wrappable form.
    const inflationaryTokenContract = new Contract(tokenAddress, inflationaryTokenAbi, provider);
    const avatar = await inflationaryTokenContract.avatar();
  
    const staticBalance = balances.filter(
        balance => avatar.toLowerCase() === balance.tokenOwner && balance.isErc1155 === true
    );
    let tokensToWrapBalance = BigInt(0);
    if (staticBalance.length) {
        tokensToWrapBalance = BigInt(staticBalance[0].staticAttoCircles);
    }

    // If the available wrappable tokens are insufficient, attempt to mint additional tokens.
    if (tokensToWrapBalance < lackingAmount) {
        const tokensToMint = lackingAmount - tokensToWrapBalance;

        let mintSucceeded = false;
        if (tokenAddress.toLocaleLowerCase() === arbBot.groupTokenAddress.toLocaleLowerCase()) {
            // Mint tokens from members excluding the group address.
            mintSucceeded = await mintIfPossibleFromMembers(tokensToMint, balances);
        } else {
            // Use the mint + redeem flow for other tokens.
            mintSucceeded = await mintIfPossibleFromOthers(tokensToMint, balances, avatar, tokenAddress);
        }
        if (!mintSucceeded) {
            return false;
        }
    }
  
    // Convert the lacking amount to a demurrage-adjusted value to prevent precision overshoots.
    const convertedAmount = await convertInflationaryToDemurrage(tokenAddress, lackingAmount - REQUIRE_PRECISION);
  
    console.log("Wrapping tokens");
    await arbBot.avatar.wrapInflationErc20(avatar, convertedAmount);
  
    return true;
}
  

async function convertInflationaryToDemurrage(tokenAddress: string, amount: bigint): Promise<bigint> {
    // @todo replace with a single onchain view function
    const inflationaryTokenContract = new Contract(tokenAddress, inflationaryTokenAbi, wallet);
    const days = await inflationaryTokenContract.day((await provider.getBlock('latest'))?.timestamp)
    const demurrageValue = await inflationaryTokenContract.convertInflationaryToDemurrageValue(amount, days);

    return demurrageValue;
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

/**
 * @notice Executes an arbitrage deal by ensuring proper token allowances and performing the swap.
 * @param deal The Deal object containing the swap data and profitability flag.
 * @param member The group member associated with the deal (used for context/logging).
 * @return A Promise that resolves to true if the swap is executed successfully, or false otherwise.
 */
async function execDeal(deal: Deal, member: GroupMember): Promise<boolean> {
    if(deal.swapData) {
        const tokenAddressToApprove = deal.swapData.inputAmount.token.address;
        // If the token has not been approved yet, set the maximum allowance.
        if(!arbBot.approvedTokens.includes(tokenAddressToApprove)) {
            const currentAllowance = await checkAllowance(tokenAddressToApprove, arbBot.address, balancerVaultAddress)
            if (currentAllowance != MAX_ALLOWANCE_AMOUNT)
                await approveTokens(tokenAddressToApprove, balancerVaultAddress);
            // Add the token to the approved tokens list.
            arbBot.approvedTokens.push(tokenAddressToApprove);
        }
        // Execute the swap using the prepared swap data.
        return await swapUsingBalancer(deal.swapData);
    }
    return false;
}

// Main function
async function getBotBalances(members: GroupMember[] = []): Promise<TokenBalanceRow[]> {
    let botBalances: TokenBalanceRow[] = await circlesData.getTokenBalances(arbBot.address);

    let memberAddresses = new Set(members.map(member => member.address.toLowerCase()));
    memberAddresses.add(arbBot.groupAddress);

    const filteredBalances = botBalances.filter(token =>
        memberAddresses.has(token.tokenOwner.toLowerCase()) && token.version === 2
    );
      
    return sortBalances(filteredBalances);
}

function sleep(pauseTime:number) {
    return new Promise(resolve => setTimeout(resolve, pauseTime));
}

async function main() {
    sdk = new Sdk(wallet, selectedCirclesConfig);
    const botAvatar = await sdk.getAvatar(arbBot.address);
    arbBot = {
        ...arbBot,
        avatar: botAvatar
    };

    while(true) {
        let pauseExecution = true;
        console.log("Loop start");
        await updateMembersCache(arbBot.groupMembersCache);

        for(let i = 0; i < arbBot.groupMembersCache.members.length; i++) {
            // @todo prettify
            try {
                await updateMemberCache(arbBot.groupMembersCache.members[i]);

                if (arbBot.groupMembersCache.members[i].latestPrice) {

                    const deal = await pickDeal(i, arbBot.groupMembersCache.members);

                    if(deal.isProfitable) {
                        const executionResult = await execDeal(deal, arbBot.groupMembersCache.members[i]);
                        if(executionResult) pauseExecution = false;
                    }
                }
            } catch (error) {
                console.error("Error in main loop iteration:", error);
                // Optionally, add a delay before restarting the loop
            }
        }

        if(pauseExecution) {
            console.log("Pause execution")
            await sleep(EXECUTION_PAUSE);
        }
        // @todo clear the dust CRCs
    }
}

main().catch(error => {
    console.error("Unhandled error in main function:", error);
    process.exit(1); // Exit with a non-zero code to trigger PM2 restart
});
