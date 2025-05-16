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
  ExactInQueryOutput,
} from "@balancer/sdk";

import { circlesConfig, Sdk } from "@circles-sdk/sdk";
import { CirclesData, CirclesRpc, TokenBalanceRow } from "@circles-sdk/data";
import { PrivateKeyContractRunner } from "@circles-sdk/adapter-ethers";

import pg from "pg"; // @dev pg is a CommonJS module
const { Client } = pg;

import {
  ArbDirection,
  Bot,
  Deal,
  GroupMember,
  MembersCache,
  FetchBalancerQuoteParams,
} from "./interfaces/index.js";

// ABI
import {
  groupRedeemAbi,
  erc20Abi,
  hubV2Abi,
  erc20LiftAbi,
  groupContractAbi,
  inflationaryTokenAbi,
  baseRedemptionEncoderAbi,
  bouncerOrgAbi,
} from "./abi/index.js";

/**
 * @notice Algorithm parameters and global configuration constants.
 */

// @dev EPSILON represents the minimum profit that we require from a deal.
// If the expected profit is below this value, the deal is not considered interesting.
const EPSILON = BigInt(1e15);

// @dev MIN_EXTRACTABLE_AMOUNT defines the minimum output amount that we are willing to extract on every swap,
// regardless of the input amount.
const MIN_EXTRACTABLE_AMOUNT = BigInt(1e17);

/**
 * @notice Global configuration constants for chain, RPC connection, and bot credentials.
 */
const chainId = ChainId.GNOSIS_CHAIN;
const rpcUrl = "https://rpc.gnosischain.com";
const botPrivateKey = process.env.PRIVATE_KEY!;

/**
 * @notice Bot execution parameters.
 * @dev EXECUTION_PAUSE is the pause duration (in milliseconds) the bot waits if no swaps were executed during an iteration.
 */
const EXECUTION_PAUSE = 60000; // 1 minute

/**
 * @notice Token approval settings.
 * @dev MAX_ALLOWANCE_AMOUNT is used when approving tokens for the Balancer vault (i.e. setting the maximum possible allowance).
 */
const MAX_ALLOWANCE_AMOUNT = ethers.MaxUint256;

/**
 * @notice Token type flags.
 * @dev DemurragedVSInflation indicates that we are interested in inflationary CRC tokens and not demurraged tokens.
 */
const DemurragedVSInflation = 1;

/**
 * @notice PostgreSQL Indexer database configuration for retrieving the latest group members.
 */
const postgresqlPW = process.env.POSTGRESQL_PW;
const postgresqlUser = "readonly_user";
const postgresqlDB = "circles";
const postgressqlHost = "144.76.163.174";
const postgressqlPort = 5432;

/**
 * @notice PostgreSQL Logger database configuration for logging bot activity
 */
const loggerDBPW = process.env.LOGGERDB_PW;
const loggerDBUser = "bot";
const loggerDBDatabase = "bot_activity";
const loggerDBHost =
  "db-postgresql-fra1-54201-do-user-1252164-0.h.db.ondigitalocean.com";
const loggerDBPort = 25060;
const loggerDBsslmode = "require";

const logQuery = `INSERT INTO "quotes" ("timestamp", "inputtoken", "outputtoken", "inputamountraw", "outputamountraw") VALUES (to_timestamp($1), $2, $3, $4, $5)`;

// global flag for logging activity
const LOG_ACTIVITY = true;

/**
 * @notice Addresses for group and helper contracts.
 * @dev groupAddress is the address of the group.
 * @dev erc20LiftAddress is the contract address that wraps ERC1155 tokens into ERC20 tokens.
 * @dev balancerVaultAddress is the address of the Balancer Vault V2.
 */
const groupAddress = process.env.GROUP_ADDRESS!;
const mintHandlerAddress = process.env.MINT_HANDLER_ADDRESS!;
const erc20LiftAddress = "0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5";
const balancerVaultAddress = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
const crcBouncerOrgAddress = "0x98B1e32Af39C1d3a33A9a2b7fe167b1b4a190872";
/**
 * @notice Initializes core blockchain objects.
 * @dev provider connects to the blockchain via the JSON RPC URL.
 * @dev wallet is created using the provided bot private key.
 */
const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new Wallet(botPrivateKey, provider);
const contractRunner = new PrivateKeyContractRunner(provider, botPrivateKey);
/**
 * @notice Circles SDK configuration objects.
 * @dev selectedCirclesConfig contains configuration details for the current chain.
 * @dev circlesRPC and circlesData are used to interact with the Circles network.
 * @dev hubV2Contract is the Circles hub contract instance.
 */
const selectedCirclesConfig = circlesConfig[chainId];
const circlesRPC = new CirclesRpc(selectedCirclesConfig.circlesRpcUrl);
const circlesData = new CirclesData(circlesRPC);
const hubV2Contract = new Contract(
  selectedCirclesConfig.v2HubAddress,
  hubV2Abi,
  wallet,
);

/**
 * @notice Global bot state.
 * @dev arbBot stores the bot address, group details, approved tokens, and a cache of group members.
 * @dev sdk will later hold an instance of the Circles SDK.
 */

let arbBot: Bot = {
    address: wallet.address,
    groupAddress: groupAddress.toLowerCase(),
    bouncerOrgContract: new Contract(
      crcBouncerOrgAddress,
      bouncerOrgAbi,
      wallet,
    ),
    approvedTokens: [],
    groupMembersCache: {
      lastUpdated: 0,
      members: [],
    },
  },
  sdk: Sdk | null;

/**
 * @notice Balancer API instance used to fetch swap paths and quotes.
 */
const balancerApi = new BalancerApi("https://api-v3.balancer.fi/", chainId);

const client = new Client({
  host: postgressqlHost,
  port: postgressqlPort,
  database: postgresqlDB,
  user: postgresqlUser,
  password: postgresqlPW,
});

const loggerClient = new Client({
  host: loggerDBHost,
  port: loggerDBPort,
  database: loggerDBDatabase,
  user: loggerDBUser,
  password: loggerDBPW,
  ssl: loggerDBsslmode === "require" ? { rejectUnauthorized: false } : false,
});

/**
 * @notice Connects to the PostgreSQL database and logs the connection status.
 * @return {Promise<void>}
 */
async function connectClient() {
  await client
    .connect()
    .then(() => {
      console.log("Connected to PostgreSQL database");
    })
    .catch((err) => {
      console.error("Error connecting to PostgreSQL database", err);
    });
}

connectClient();

/**
 * @notice Connects to the Logger database and logs the connection status.
 * @return {Promise<void>}
 */
async function connectLogging() {
  if (!LOG_ACTIVITY) return;
  await loggerClient
    .connect()
    .then(() => {
      console.log("Connected to Logger database");
    })
    .catch((err) => {
      console.error("Error connecting to Logger database", err);
    });
}

connectLogging();

/**
 * @notice Retrieves the current group members from the PostgreSQL database.
 * @return {Promise<GroupMember[]>} A promise that resolves to an array of GroupMember objects.
 */
async function getGroupMembers(): Promise<GroupMember[]> {
  const currentUNIXTime = Math.floor(Date.now() / 1000);
  try {
    const res = await client.query(
      'SELECT "member" AS "address" FROM "V_CrcV2_GroupMemberships" WHERE "group" = $1 AND "expiryTime" > $2',
      [arbBot.groupAddress, currentUNIXTime],
    );
    return res.rows as GroupMember[];
  } catch (err) {
    console.error("Error running query", err);
    return [];
  }
}

/**
 * @notice Checks the ERC20 token allowance for a given owner and spender.
 * @param tokenAddress The ERC20 token contract address.
 * @param ownerAddress The address owning the tokens.
 * @param spenderAddress The address allowed to spend the tokens.
 * @return {Promise<bigint>} A promise that resolves to the allowance as a bigint.
 */
async function checkAllowance(
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
): Promise<bigint> {
  // Create a contract instance for the token
  const tokenContract = new Contract(tokenAddress, erc20Abi, provider);

  // Fetch the allowance
  const allowance = await tokenContract.allowance(ownerAddress, spenderAddress);
  return allowance;
}

/**
 * @notice Fetches the latest Balancer swap quote for a token.
 * @param tokenAddress The token address to get a quote for.
 * @param groupToMember If true, swap is from group token to member token; otherwise, from member token to group token.
 * @param amountOut The output amount for the swap.
 * @return {Promise<Swap | null>} A promise that resolves to a Swap object if a valid path is found, or null otherwise.
 */
async function fetchBalancerQuote({
  tokenAddress,
  direction = ArbDirection.BUY_MEMBER_TOKENS,
  amountOut = MIN_EXTRACTABLE_AMOUNT,
  logQuote = false,
}: FetchBalancerQuoteParams): Promise<Swap | null> {
  // @todo move to global var
  const groupTokenInstance = new Token(
    chainId,
    arbBot.groupTokenAddress as `0x${string}`,
    18,
    "Group Token",
  );

  const memberToken = new Token(
    chainId,
    tokenAddress as `0x${string}`,
    18,
    "Member Token",
  );

  const inToken =
    direction == ArbDirection.BUY_MEMBER_TOKENS
      ? groupTokenInstance
      : memberToken;
  const outToken =
    direction == ArbDirection.BUY_MEMBER_TOKENS
      ? memberToken
      : groupTokenInstance;

  const swapKind = SwapKind.GivenOut;
  const pathInput = {
    chainId,
    tokenIn: inToken.address,
    tokenOut: outToken.address,
    swapKind: swapKind,
    swapAmount: TokenAmount.fromRawAmount(outToken, amountOut),
  };
  const sorPaths = await balancerApi.sorSwapPaths
    .fetchSorSwapPaths(pathInput)
    .catch(() => {
      console.error("ERROR: Swap path not found");
    });

  // if there is no path, we return null
  if (!sorPaths || sorPaths.length === 0) {
    if (logQuote) {
      const logValues = [
        Math.floor(Date.now() / 1000),
        inToken.address,
        outToken.address,
        null,
        amountOut.toString(),
      ];
      await loggerClient.query(logQuery, logValues);
    }
    console.log("No path found");
    return null;
  }
  // Swap object provides useful helpers for re-querying, building call, etc
  const swap = new Swap({
    chainId,
    paths: sorPaths,
    swapKind,
  });
  // @todo: we're here hardcoding our knowledge of the internals of the fetchBalancerQuote function
  if (logQuote) {
    const logValues = [
      Math.floor(Date.now() / 1000),
      inToken.address,
      outToken.address,
      swap.inputAmount.amount.toString(),
      swap.outputAmount.amount.toString(),
    ];
    await loggerClient.query(logQuery, logValues);
  }

  // @dev We attempt to make this call to validate the swap parameters, ensuring we avoid potential errors such as `BAL#305` or other issues related to swap input parameters.
  const result = await swap
    .query(rpcUrl)
    .then(() => {
      return swap;
    })
    .catch((error: any) => {
      console.error(error?.shortMessage);
      return null;
    });

  return result;
}

async function getERC20TokenAvatar(tokenAddress: string): Promise<string> {
  const inflationaryTokenContract = new Contract(
    tokenAddress,
    inflationaryTokenAbi,
    provider,
  );
  const avatar = await inflationaryTokenContract.avatar();

  return avatar.toLowerCase();
}

async function getERC20Token(avatarAddress: string): Promise<string> {
  const tokenWrapperContract = new Contract(
    erc20LiftAddress,
    erc20LiftAbi,
    provider,
  );
  const tokenAddress = await tokenWrapperContract.erc20Circles(
    DemurragedVSInflation,
    avatarAddress,
  );

  return tokenAddress.toLowerCase();
}

async function getRedeemOperator(groupAddress: string): Promise<string> {
  const groupContract = new Contract(groupAddress, groupContractAbi, provider);
  const redemptionOperatorAddress = await groupContract.redemptionHandler();

  return redemptionOperatorAddress.toLowerCase();
}

/**
 * @notice Updates the bot's members cache by fetching new group members from the database.
 * @param membersCache The current members cache object.
 * @return {Promise<void>}
 */
async function updateMembersCache(membersCache: MembersCache) {
  console.log("Updating members cache...");

  // We fetch the latest members from the database
  console.log("Fetching latest members...");
  const newMembers = await getGroupMembers();

  membersCache.members = newMembers;
  membersCache.lastUpdated = Math.floor(Date.now() / 1000);
}

/**
 * @notice Executes a swap on Balancer using the provided Swap object.
 * @param swap The Swap object containing the swap parameters and paths.
 * @return {Promise<boolean>} A promise that resolves to true if the swap is executed successfully, or false otherwise.
 */
async function swapUsingBalancer(
  swap: Swap,
  attempt: number = 1,
): Promise<boolean> {
  // Get up to date swap result by querying onchain
  const updated = (await swap.query(rpcUrl)) as ExactInQueryOutput;

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
  // This is in case the situation changed since the time we picked the deal as a candidate.
  if (callData.maxAmountIn.amount > swap.outputAmount.amount - EPSILON) {
    console.log(
      "Input Amount",
      callData.maxAmountIn.amount,
      " Output Amount:",
      swap.outputAmount.amount,
      " EPSILON: ",
      EPSILON,
    );
    console.log("returning before executing");
    return false;
  }

  console.log(
    `
        Input token: ${swap.inputAmount.token.address}, amountIn: ${callData.maxAmountIn.amount}
        Output token: ${swap.outputAmount.token.address}, amountOut: ${swap.outputAmount.amount}
        `,
  );

  return await wallet
    .sendTransaction({ to: callData.to, data: callData.callData })
    .then((txResponse) => {
      console.log("Swap tx:", txResponse?.hash);

      return !!txResponse?.hash;
    })
    .catch(async () => {
      console.error("!!! Transaction failed !!!");
      // @notice if tx fails we check if we have enough required tokens,
      // the `swap.inputAmount.amount` and `callData.maxAmountIn.amount` values might differ significantly

      if (
        callData.maxAmountIn.amount > swap.inputAmount.amount &&
        attempt != 0
      ) {
        console.log("Second swap attempt");
        await requireTokens(
          swap.inputAmount.token.address,
          callData.maxAmountIn.amount,
        );
        return await swapUsingBalancer(swap, 0);
      }

      return false;
    });
}

/**
 * @notice Updates trust relationships with the bouncer organization for specified addresses
 * @param toTokens address to establish trust with
 * @return {Promise<boolean>} Returns true if rust relationships is successfully established
 */
async function updateBouncerOrgTrust(tokenAvatar: string): Promise<boolean> {
  if (!arbBot.bouncerOrgContract) {
    console.error("Bouncer org contract not initialized");
    return false;
  }

  try {
    // Check if trust already exists
    const isTrusted = await hubV2Contract.isTrusted(
      crcBouncerOrgAddress,
      tokenAvatar,
    );

    if (!isTrusted) {
      // Force trust using the bouncer org contract
      const tx = await arbBot.bouncerOrgContract.forceTrust(tokenAvatar);
      await tx.wait();
      console.log(`Bouncer Org forceTrusted: ${tokenAvatar}`);
    }

    return true;
  } catch (error) {
    console.error("Error updating bouncer org trust:", error);
    return false;
  }
}

/**
 * @notice Calculates the total theoretical amount of tokens that could be available,
 *         combining the bot’s current ERC20 balance, tokens available in wrappable erc1155 form,
 *         and tokens that could potentially be minted from member balances.
 * @param tokenAddress The token address for which to compute the theoretical available amount.
 * @return {Promise<bigint>} A promise that resolves to the total theoretical available token amount.
 *
 */
async function theoreticallyAvailableAmountCRC(
  tokenAddress: string | undefined,
): Promise<bigint> {
  if (!tokenAddress) return BigInt(0);

  tokenAddress = tokenAddress.toLowerCase();
  const tokenAvatar = await getERC20TokenAvatar(tokenAddress);

  // fetch the bot's token botBalances
  // @todo this could probably be cached
  const balances = await circlesData.getTokenBalances(arbBot.address);
  if (!balances) return BigInt(0);

  // get the current erc1155 balance (in demurraged units)
  let erc1155TokenBalance =
    balances.find(
      (token: TokenBalanceRow) =>
        token.tokenOwner.toLowerCase() === tokenAvatar &&
        token.version === 2 &&
        token.isErc1155,
    )?.attoCircles ?? 0;

  // get the current erc20 balance (in demurraged units)
  let erc20TokenBalance =
    balances.find(
      (token: TokenBalanceRow) =>
        token.tokenOwner.toLowerCase() === tokenAvatar &&
        token.version === 2 &&
        token.isErc20,
    )?.attoCircles ?? 0;

  // find out how many tokens we can turn to the target token via the pathfinder, excluding the existing target balances
  const remainingTokens = balances
    .map((b: TokenBalanceRow) => b.tokenAddress.toLowerCase())
    .filter(
      (address: string) =>
        address !== tokenAddress.toLowerCase() &&
        address !== tokenAvatar.toLowerCase(),
    );

  let toAddress;
  let toTokens;

  if (tokenAvatar === arbBot.groupAddress) {
    toAddress = mintHandlerAddress;
    toTokens = undefined;
  } else {
    toAddress = crcBouncerOrgAddress;
    toTokens = [tokenAvatar!];
    await updateBouncerOrgTrust(tokenAvatar!);
  }

  const maxTransferable = await arbBot.avatar.getMaxTransferableAmount(
    toAddress,
    undefined,
    true,
    remainingTokens,
    toTokens,
  );

  const pullableAmountString = (maxTransferable * 1e18).toFixed(0);
  const pullableAmount = BigInt(pullableAmountString);

  // Round down to 6 decimal places (12 trailing zeros). The reason for this is a bit subtle, but basically
  // the sdk, which is being used to perform these transactions, sometimes throws errors if the inputs
  // has too many significant digits. By reducing the pullable Amount here, we can ensure that we can later
  // perform an actual transfer that is both sufficiently high for the desired deal and also definitely below the actual pullable Amount.
  const roundedPullableAmount = (pullableAmount / BigInt(1e12)) * BigInt(1e12);
  const extractableAmount =
    BigInt(erc1155TokenBalance) +
    BigInt(erc20TokenBalance) +
    roundedPullableAmount;

  // Finally, get the amount in current static units
  const inflationaryValue = await convertDemurrageToInflationary(
    tokenAddress,
    extractableAmount,
  );

  console.log(
    "target token: ",
    tokenAddress,
    "\n existing erc155 balance: ",
    erc1155TokenBalance,
    "\n achievable additional erc1155 balance: ",
    pullableAmount,
    "\n total pullable amount in erc20 units: ",
    inflationaryValue,
  );

  return inflationaryValue;
}

/**
 * @notice Updates a specific group member's cache data, including token address and latest price.
 * @param member The group member object to update.
 * @return {Promise<GroupMember>} A promise that resolves to the updated GroupMember.
 */
async function updateMemberCache(member: GroupMember): Promise<GroupMember> {
  console.log(`Updating member ${member.address}`);
  const tokenWrapperContract = new Contract(
    erc20LiftAddress,
    erc20LiftAbi,
    wallet,
  );
  // we call the contract 1 by 1 for each address

  if (member.tokenAddress === ethers.ZeroAddress || !member.tokenAddress) {
    const tokenAddress = await tokenWrapperContract.erc20Circles(
      DemurragedVSInflation,
      member.address,
    );
    member.tokenAddress = tokenAddress;
  }

  if (member.tokenAddress !== ethers.ZeroAddress && member.tokenAddress) {
    const quote = await fetchBalancerQuote({
      tokenAddress: member.tokenAddress,
      logQuote: LOG_ACTIVITY,
    });
    if (quote) member.latestPrice = quote!.inputAmount.amount;
    member.latestPrice = quote ? quote.inputAmount.amount : 0n;
    member.lastPriceUpdate = Math.floor(Date.now() / 1000);
  }

  return member;
}

/**
 * @notice Aggregates the swap parameters to progressively find a better swap quote by increasing the output amount.
 * @param tokenAddress The token address for which to optimize the swap.
 * @param direction The swap direction; true for token to group token, false otherwise.
 * @param currentPrice The current best input price observed.
 * @param currentAmountOut The current baseline output amount.
 * @return {Promise<Swap | null>} A promise that resolves to the best Swap object that meets profitability criteria, or null if none is found.
 */
async function amountOutGuesser(
  tokenAddress: string,
  direction: ArbDirection = ArbDirection.BUY_MEMBER_TOKENS,
  currentPrice: bigint = BigInt(0),
  currentAmountOut: bigint = MIN_EXTRACTABLE_AMOUNT,
): Promise<Swap | null> {
  const maxAttempts = 100;
  let bestSwapData: Swap | null = null;
  let prevProfit = BigInt(0);
  // @todo add comments
  const tokenToCheck =
    direction == ArbDirection.BUY_MEMBER_TOKENS
      ? arbBot.groupTokenAddress
      : tokenAddress;
  // const directionString =
  //   direction == ArbDirection.BUY_MEMBER_TOKENS
  //     ? "group to member"
  //     : "member to group";
  const availableTokensAmount =
    await theoreticallyAvailableAmountCRC(tokenToCheck);

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Propose a new amount by doubling the current amount out.
    const proposedAmountOut = currentAmountOut * 2n;
    const quote = await fetchBalancerQuote({
      tokenAddress: tokenAddress,
      direction: direction,
      amountOut: proposedAmountOut,
    });
    const nextPrice = quote?.inputAmount.amount ?? BigInt(0);
    // @todo doublecheck if there is a redundancy
    if (
      currentPrice < nextPrice &&
      nextPrice <= availableTokensAmount &&
      nextPrice < proposedAmountOut - EPSILON
    ) {
      currentAmountOut = proposedAmountOut;
      currentPrice = nextPrice;
      // @notice Check if the absolute profit has improved.
      if (prevProfit < proposedAmountOut - nextPrice) {
        bestSwapData = quote;
        prevProfit = proposedAmountOut - nextPrice;
      }
    } else break; // Exit if no improvement is found.
  }

  return bestSwapData;
}

/**
 * @notice Picks a potential arbitrage deal for a given group member by evaluating swap profitability and executability.
 * @param memberIndex The index of the member in the group members array to evaluate.
 * @param groupMembers An array of group members containing pricing and token information.
 * @return {Promise<Deal>} A promise that resolves to a Deal object containing flags for profitability/executability and associated swap data.
 */
async function pickDeal(member: GroupMember): Promise<Deal> {
  // let isProfitable = true;
  let amountIn = member.latestPrice ?? BigInt(0);
  let direction = ArbDirection.BUY_MEMBER_TOKENS;
  let swapData = null;
  let amountOut = MIN_EXTRACTABLE_AMOUNT;

  // If there's no price yet or if it's larger than one, we flip the direction of the trade
  // and update the quote (for the default direction we don't need to as we've just done so)
  if (amountIn === BigInt(0) || amountIn > MIN_EXTRACTABLE_AMOUNT) {
    direction = ArbDirection.BUY_GROUP_TOKENS;
    // Update the quotes
    swapData = await fetchBalancerQuote({
      tokenAddress: member.tokenAddress,
      direction: direction,
      logQuote: LOG_ACTIVITY,
    });
    amountIn = swapData?.inputAmount.amount ?? BigInt(0);
    amountOut = swapData?.outputAmount.amount ?? BigInt(0);

    // if (amountIn === BigInt(0) || amountIn > amountOut - EPSILON) {
    //   isProfitable = false;
    // }
  }

  // If we don't see a good initial ratio, we return
  // @todo: Epsilon should more sensibly check the ratio, not the difference
  if (amountIn > MIN_EXTRACTABLE_AMOUNT - EPSILON) {
    return {
      isProfitable: false,
      swapData,
    };
  }

  // Find the optimal data for the deal
  const recommendedSwapData = await amountOutGuesser(
    member.tokenAddress,
    direction,
    amountIn,
  );

  // update the candidate swap
  swapData = recommendedSwapData ?? swapData;
  amountIn = swapData?.inputAmount.amount ?? BigInt(0);
  amountOut = swapData?.outputAmount.amount ?? BigInt(0);

  return {
    isProfitable: amountIn <= amountOut - EPSILON,
    swapData,
  };
}

/**
 * @notice Ensures that the bot has the required amount of tokens for a swap operation.
 *         If the current balance is insufficient, attempts to mint or redeem additional tokens.
 * @param tokenAddress The address of the token required.
 * @param tokenAmount The total token amount required (expressed as a bigint).
 * @return {Promise<boolean>} A promise that resolves to true if the required tokens are available or can be acquired, false otherwise.
 */
async function requireTokens(
  tokenAddress: string,
  tokenAmount: bigint,
): Promise<boolean> {
  // @todo check if token is from member
  // Increase the token amount slightly to account for precision issues.
  // @todo Check that this does not imply we're asking for more than we can get.
  // tokenAmount; += REQUIRE_PRECISION;

  tokenAddress = tokenAddress.toLowerCase();
  const tokenAvatar = await getERC20TokenAvatar(tokenAddress);

  const tokenAmountDemurragedUnits = await convertInflationaryToDemurrage(
    tokenAddress,
    tokenAmount,
  );

  // fetch the bot's token botBalances
  // @todo this could probably be cached
  const balances = await circlesData.getTokenBalances(arbBot.address);
  if (!balances) return false;

  // get the current erc1155 balance (in demurraged units)
  let erc1155TokenBalance = BigInt(
    balances.find(
      (token: TokenBalanceRow) =>
        token.tokenOwner.toLowerCase() === tokenAvatar &&
        token.version === 2 &&
        token.isErc1155,
    )?.attoCircles ?? 0,
  );

  // get the current erc20 balance (in demurraged units)
  let erc20TokenBalance = BigInt(
    balances.find(
      (token: TokenBalanceRow) =>
        token.tokenOwner.toLowerCase() === tokenAvatar &&
        token.version === 2 &&
        token.isErc20,
    )?.attoCircles ?? 0,
  );

  //calculate the missing amount in demurraged units
  let missingAmountDemurragedUnits =
    tokenAmountDemurragedUnits - erc20TokenBalance;

  console.log(`
    erc1155TokenBalance: ${erc1155TokenBalance}
    erc20TokenBalance: ${erc20TokenBalance}
    missingAmountDemurragedUnits: ${missingAmountDemurragedUnits}
    requested demurraged units: ${tokenAmountDemurragedUnits}
    request amount in static units: ${tokenAmount}
  `);

  if (missingAmountDemurragedUnits <= 0) {
    // sufficient erc20 balance
    console.log("No additional tokens required");
    return true;
  } else if (missingAmountDemurragedUnits > erc1155TokenBalance) {
    // we need to obtain some additional erc1155 balance
    console.log("Pulling additional tokens through pathfinder.");
    const amountToPull = missingAmountDemurragedUnits - erc1155TokenBalance;

    // we here actually pull a little bit more than we'd need to deal with the sdk limitations.
    // Because we previously rounded the theorteicallyAvailableAmount *down* we are actually guaranteed
    // that this won't cause any problems.
    const sigFigs = BigInt(1e12);
    const roundedAmountToPull =
      ((amountToPull + sigFigs - BigInt(1)) / sigFigs) * sigFigs;

    const remainingTokens = balances
      .map((b: TokenBalanceRow) => b.tokenAddress.toLowerCase())
      .filter(
        (address: string) =>
          address !== tokenAddress.toLowerCase() &&
          address !== tokenAvatar.toLowerCase(),
      );

    let toAddress;
    let toTokens;

    if (tokenAvatar === arbBot.groupAddress) {
      toAddress = mintHandlerAddress;
      toTokens = undefined;
    } else {
      toAddress = crcBouncerOrgAddress;
      toTokens = [tokenAvatar!];
      await updateBouncerOrgTrust(tokenAvatar!);
    }
    try {
      console.log(`
        toAddress: ${toAddress},
        roundedAmountToPull: ${roundedAmountToPull},
        remainingTokens: ${remainingTokens},
        toTokens: ${toTokens}
      `);
      const transferReceipt = await arbBot.avatar.transfer(
        toAddress,
        roundedAmountToPull,
        undefined,
        undefined,
        true,
        remainingTokens,
        toTokens,
      );
      if (!transferReceipt || transferReceipt.status === 0) {
        console.error("Transfer failed");
        return false;
      }
    } catch (error) {
      console.error("Transfer failed:", error);
      return false;
    }
  }

  // finally we unwrap any outstanding amounts
  try {
    console.log("Wrapping tokens");
    const wrapReceipt = await arbBot.avatar.wrapInflationErc20(
      tokenAvatar,
      missingAmountDemurragedUnits,
    );

    if (!wrapReceipt || wrapReceipt.status === 0) {
      console.error("Wrapping failed");
      return false;
    }

    return true;
  } catch (error) {
    console.error("Wrapping failed:", error);
    return false;
  }
}
/**
 * @notice Converts an inflationary token amount to its corresponding demurrage-adjusted value.
 * @param tokenAddress The address of the inflationary token.
 * @param amount The amount to convert.
 * @return {Promise<bigint>} A promise that resolves to the converted demurrage value.
 */
async function convertInflationaryToDemurrage(
  tokenAddress: string,
  amount: bigint,
): Promise<bigint> {
  // @todo replace with a single onchain view function
  const inflationaryTokenContract = new Contract(
    tokenAddress,
    inflationaryTokenAbi,
    wallet,
  );
  const days = await inflationaryTokenContract.day(
    (await provider.getBlock("latest"))?.timestamp,
  );
  const demurrageValue =
    await inflationaryTokenContract.convertInflationaryToDemurrageValue(
      amount,
      days,
    );

  return demurrageValue;
}

/**
 * @notice Converts a demurrage token amount to its corresponding inflationary value.
 * @param tokenAddress The address of the inflationary token.
 * @param amount The amount to convert.
 * @return {Promise<bigint>} A promise that resolves to the converted inflationary value.
 */
async function convertDemurrageToInflationary(
  tokenAddress: string,
  amount: bigint,
): Promise<bigint> {
  const inflationaryTokenContract = new Contract(
    tokenAddress,
    inflationaryTokenAbi,
    wallet,
  );
  const days = await inflationaryTokenContract.day(
    (await provider.getBlock("latest"))?.timestamp,
  );
  const inflationaryValue =
    await inflationaryTokenContract.convertDemurrageToInflationaryValue(
      amount,
      days,
    );

  return inflationaryValue;
}

/**
 * @notice Approves a specified token for spending by a designated operator.
 * @param tokenAddress The ERC20 token address.
 * @param operatorAddress The address to be approved.
 * @param amount The allowance amount (default is MAX_ALLOWANCE_AMOUNT).
 * @return {Promise<void>}
 */
async function approveTokens(
  tokenAddress: string,
  operatorAddress: string,
  amount: bigint = MAX_ALLOWANCE_AMOUNT,
) {
  const groupTokenContract = new Contract(tokenAddress, erc20Abi, wallet);
  const approveTx = await groupTokenContract.approve(operatorAddress, amount);
  await approveTx.wait();
}

/**
 * @notice Executes an arbitrage deal by ensuring proper token allowances and performing the swap.
 * @param deal The Deal object containing the swap data and profitability flag.
 * @param member The group member associated with the deal (used for context/logging).
 * @return {Promise<boolean>} A promise that resolves to true if the swap is executed successfully, or false otherwise.
 */
async function execDeal(deal: Deal): Promise<boolean> {
  console.log("Executing deal");
  if (deal.swapData) {
    const tokenAddressToApprove = deal.swapData.inputAmount.token.address;
    // If the token has not been approved yet, set the maximum allowance.
    if (!arbBot.approvedTokens.includes(tokenAddressToApprove)) {
      const currentAllowance = await checkAllowance(
        tokenAddressToApprove,
        arbBot.address,
        balancerVaultAddress,
      );
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

/**
 * @notice Pauses execution for a specified duration.
 * @param pauseTime The amount of time in milliseconds to sleep.
 * @return {Promise<void>} A promise that resolves after the pause time has elapsed.
 */
function sleep(pauseTime: number) {
  return new Promise((resolve) => setTimeout(resolve, pauseTime));
}

/**
 * @notice Converts an Ethereum address to a token ID by removing the '0x' prefix,
 *         converting to lowercase, and padding to 32 bytes.
 * @param address The Ethereum address to convert.
 * @return {bigint} The address converted to a bigint token ID.
 */
function toTokenId(address: string): bigint {
  // Remove "0x" prefix if present and pad to 64 characters (32 bytes)
  const paddedHex = address.toLowerCase().replace("0x", "").padStart(64, "0");
  return BigInt("0x" + paddedHex);
}

/**
 * @notice Main function that initializes the SDK, updates member caches, and continuously attempts arbitrage deals.
 * @return {Promise<void>} A promise that never resolves unless an unhandled error occurs.
 */
async function main() {
  console.log(selectedCirclesConfig);
  const contractRunner = new PrivateKeyContractRunner(provider, botPrivateKey);
  await contractRunner.init();
  sdk = new Sdk(contractRunner, selectedCirclesConfig);
  const botAvatar = await sdk.getAvatar(arbBot.address);
  arbBot = {
    ...arbBot,
    avatar: botAvatar,
    groupTokenAddress: await getERC20Token(arbBot.groupAddress),
  };
  console.log("initiating bot with parameters", arbBot);

  while (true) {
    let pauseExecution = true;
    console.log("Loop start");
    await updateMembersCache(arbBot.groupMembersCache);

    for (let i = 0; i < arbBot.groupMembersCache.members.length; i++) {
      // @todo prettify
      try {
        await updateMemberCache(arbBot.groupMembersCache.members[i]);

        if (arbBot.groupMembersCache.members[i].latestPrice) {
          const member = arbBot.groupMembersCache.members[i];
          const deal = await pickDeal(member);
          if (deal.isProfitable) {
            console.log("Checking required additional required tokens");
            const requiredTokensAvailable = await requireTokens(
              deal.swapData?.inputAmount.token.address || "",
              deal.swapData?.inputAmount.amount!,
            );

            if (LOG_ACTIVITY) {
              const dealData = deal.swapData;
              const logValues = [
                Math.floor(Date.now() / 1000),
                dealData?.inputAmount.token.address,
                dealData?.outputAmount.token.address,
                dealData?.inputAmount.amount.toString(),
                dealData?.outputAmount.amount.toString(),
              ];

              console.log("Candidate deal data:", logValues);

              await loggerClient.query(logQuery, logValues);
            }
            if (requiredTokensAvailable) {
              const executionResult = await execDeal(deal);
              if (executionResult) pauseExecution = false;
            }
          }
        }
      } catch (error) {
        console.error("Error in main loop iteration:", error);
        // Optionally, add a delay before restarting the loop
      }
    }

    if (pauseExecution) {
      console.log("Pause execution");
      await sleep(EXECUTION_PAUSE);
    }
    // @todo clear the dust CRCs
  }
}

main().catch((error) => {
  console.error("Unhandled error in main function:", error);
  process.exit(1); // Exit with a non-zero code to trigger PM2 restart
});
