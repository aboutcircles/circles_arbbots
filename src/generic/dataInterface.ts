import pg from "pg";
const { Client } = pg;
import WebSocket from "ws";
import assert from "assert";

if (!global.WebSocket) {
  (global as any).WebSocket = WebSocket;
}

import {
  BalanceRow,
  BaseGroupRow,
  CirclesNode,
  Direction,
  FetchBalancerQuoteParams,
  LatestPriceRow,
  TrustRelationRow,
  Address,
  DataInterfaceParams,
  SwapExecutionOptions,
  TradeExecutionResult,
  Trade,
} from "./interfaces/index.js";

// Import ethers v6
import { ethers, Contract, Wallet } from "ethers";

// ABI
import {
  erc20Abi,
  hubV2Abi,
  erc20LiftAbi,
  inflationaryTokenAbi,
  middlewareAbi,
} from "./abi/index.js";

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
  ExactOutQueryOutput,
  max,
} from "@balancer/sdk";

import { circlesConfig, Sdk, Avatar } from "@circles-sdk/sdk";
import { CirclesData, CirclesRpc } from "@circles-sdk/data";
import { PrivateKeyContractRunner } from "@circles-sdk/adapter-ethers";
import { baseGroupAbi } from "./abi/index.js";

// Global config
const rpcUrl = "https://rpc.gnosischain.com";
const DemurragedVSInflation = 1;
const chainId = ChainId.GNOSIS_CHAIN;
const botPrivateKey = process.env.PRIVATE_KEY!;
const SELLOFF_PRECISION = BigInt(1e12);

// Constant addresses
const erc20LiftAddress = "0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5";
const middlewareAddress = "0x6C301FCe295c0524dd1FEeFF4eF2e43Fc5e7648d";

/**
 * @notice Initializes core blockchain objects.
 * @dev provider connects to the blockchain via the JSON RPC URL.
 * @dev wallet is created using the provided bot private key.
 */
const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new Wallet(botPrivateKey, provider);

/**
 * @notice Balancer API instance used to fetch swap paths and quotes.
 */
const balancerApi = new BalancerApi("https://api-v3.balancer.fi/", chainId);

/**
 * @notice Circles SDK configuration objects.
 * @dev selectedCirclesConfig contains configuration details for the current chain.
 * @dev circlesRPC and circlesData are used to interact with the Circles network.
 * @dev hubV2Contract is the Circles hub contract instance.
 */
const selectedCirclesConfig = circlesConfig[chainId];
const hubV2Contract = new Contract(
  selectedCirclesConfig.v2HubAddress as string,
  hubV2Abi,
  wallet,
);

const logQuoteInsertQuery = `INSERT INTO "quotes" ("timestamp", "inputtoken", "outputtoken", "inputamountraw", "outputamountraw") VALUES (to_timestamp($1), $2, $3, $4, $5)`;

const logTradeInsertQuery = `INSERT INTO "tradeOpportunties" ("timestamp", "buytoken", "selltoken", "referencetoken", "buyamount", "intermediateamount", "sellamount", "estimatedprofit") VALUES (to_timestamp($1), $2, $3, $4, $5, $6, $7, $8)`;

const logLiquidityEstimateQuery = `
  INSERT INTO "liquidity_estimates" (
    "timestamp",
    "source_avatar",
    "target_avatar",
    "source_token",
    "target_token",
    "liquidity"
  )
  VALUES (to_timestamp($1), $2, $3, $4, $5, $6)
`;

const middlewareContract = new Contract(
  middlewareAddress,
  middlewareAbi,
  wallet,
);

export class DataInterface {
  private client: pg.Client;
  private loggerClient: pg.Client;
  public quoteReferenceAmount: bigint;
  public quotingToken: Token;
  public tradingToken: Token;
  public logActivity: boolean;
  public sdk?: Sdk;
  public sdkAvatar?: Avatar;

  constructor(params: DataInterfaceParams) {
    this.client = new pg.Client({
      host: "144.76.163.174",
      port: 5432,
      database: "circles",
      user: "readonly_user",
      password: process.env.POSTGRESQL_PW,
    });

    this.loggerClient = new pg.Client({
      host: "db-postgresql-fra1-54201-do-user-1252164-0.h.db.ondigitalocean.com",
      port: 25060,
      database: "bot_activity",
      user: "bot",
      password: process.env.LOGGERDB_PW,
      ssl: {
        rejectUnauthorized: false,
      },
    });

    this.quoteReferenceAmount = params.quoteReferenceAmount;

    console.log("loading quoting token", params.quotingToken);
    this.quotingToken = new Token(
      chainId,
      params.quotingToken,
      Number(params.collateralTokenDecimals),
      "Quote Token",
    );

    console.log("loading trading token", params.tradingToken);
    this.tradingToken = new Token(
      chainId,
      params.tradingToken,
      Number(params.tradingTokenDecimals),
      "Trading Token",
    );

    this.logActivity = params.logActivity;
  }

  async init(): Promise<void> {
    // Initialize contract runner
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    // const wallet = new Wallet(botPrivateKey, this.provider);

    const contractRunner = new PrivateKeyContractRunner(
      provider,
      botPrivateKey,
    );
    await contractRunner.init();

    // Initialize SDK
    this.sdk = new Sdk(contractRunner, selectedCirclesConfig);

    // Connect to database
    await this.client
      .connect()
      .then(() => {
        console.log("Connected to PostgreSQL database");
      })
      .catch((err) => {
        console.error("Error connecting to PostgreSQL database", err);
      });

    // Connect to logger database
    await this.loggerClient
      .connect()
      .then(() => {
        console.log("Connected to Logger database");
      })
      .catch((err) => {
        console.error("Error connecting to Logger database", err);
      });

    console.log("Loading bot avatar with address ", wallet.address);
    this.sdkAvatar = await this.sdk.getAvatar(wallet.address as Address);
  }

  async cleanup(): Promise<void> {
    await this.client.end();
    await this.loggerClient.end();
  }

  public async getBalances(tokens: string[]): Promise<BalanceRow[]> {
    try {
      const query = `
            SELECT
                account,
                "demurragedTotalBalance"::numeric as "demurragedTotalBalance",
                "tokenAddress"
            FROM "V_CrcV2_BalancesByAccountAndToken"
            WHERE "tokenAddress" = ANY($1)
        `;

      const result = await this.client.query(query, [
        tokens.map((address) => address.toLowerCase()),
      ]);
      return result.rows.map((row) => ({
        account: row.account,
        demurragedTotalBalance: BigInt(row.demurragedTotalBalance), // Convert to BigInt if needed
        tokenAddress: row.tokenAddress,
      }));
    } catch (error) {
      console.error("Error fetching balances:", error);
      return [];
    }
  }

  public async getTrustRelations(
    params: {
      trusters?: string[];
      trustees?: string[];
    } = {},
  ): Promise<TrustRelationRow[]> {
    try {
      let query = `
              SELECT "truster", "trustee"
              FROM "V_CrcV2_TrustRelations"
          `;

      const conditions: string[] = [];
      const queryParams: string[] = [];

      if (params.trusters?.length) {
        let trusters = params.trusters.map((truster) => truster.toLowerCase());
        // Use ARRAY constructor instead of JSON.stringify
        queryParams.push(`{${trusters.join(",")}}`);
        conditions.push(`"truster" = ANY($${queryParams.length})`);
      }

      if (params.trustees?.length) {
        let trustees = params.trustees.map((trustee) => trustee.toLowerCase());
        // Use ARRAY constructor instead of JSON.stringify
        queryParams.push(`{${trustees.join(",")}}`);
        conditions.push(`"trustee" = ANY($${queryParams.length})`);
      }

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(" AND ")}`;
      }

      const result = await this.client.query(query, queryParams);
      return result.rows.map((row) => ({
        truster: row.truster,
        trustee: row.trustee,
      }));
    } catch (error) {
      console.error("Error fetching trust relations:", error);
      return [];
    }
  }

  public async getMaxHolder(avatarAddress: string): Promise<Address | null> {
    try {
      const query = `
      SELECT "account", "demurragedTotalBalance"
      FROM "V_CrcV2_BalancesByAccountAndToken"
      WHERE "tokenAddress" = $1
      ORDER BY "demurragedTotalBalance" DESC
      LIMIT 1
    `;

      const result = await this.client.query(query, [
        avatarAddress.toLowerCase(),
      ]);

      if (result.rows.length > 0) {
        return result.rows[0].account;
      }

      return null;
    } catch (error) {
      console.error("Error fetching max holder:", error);
      return null;
    }
  }

  public async getMaxTransferableAmount(params: {
    from: Address;
    to: Address;
    fromTokens?: Address[];
    toTokens?: Address[];
  }): Promise<bigint> {
    const findPathPayload = {
      jsonrpc: "2.0",
      id: 0,
      method: "circlesV2_findPath",
      params: [
        {
          Source: params.from,
          Sink: params.to,
          FromTokens: params.fromTokens,
          ToTokens: params.toTokens,
          WithWrap: true,
          TargetFlow: "99999999999999999999999999999999999",
        },
      ],
    };

    // const body = JSON.stringify(findPathPayload);
    // console.log("pathfinder query body: ", body);
    const response = await fetch("https://rpc.aboutcircles.com/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(findPathPayload),
    });

    const data = await response.json();

    return data.result.maxFlow;
  }

  public async getSimulatedLiquidity(
    source: CirclesNode,
    target: CirclesNode,
  ): Promise<bigint> {
    try {
      const maxHolder = await this.getMaxHolder(source.avatar);
      if (!maxHolder) {
        console.log("No max holder found, returning 0");
        return 0n;
      }

      const to = target.isGroup ? target.mintHandler! : target.avatar; // we're using the fact that all hunman account trust themselves (and cannot do otherwise)
      const fromTokens = [source.avatar];
      const toTokens = target.isGroup ? undefined : [target.avatar];

      const maxTransferableAmount = await this.getMaxTransferableAmount({
        from: maxHolder,
        to: to,
        fromTokens: fromTokens,
        toTokens: toTokens,
      });

      // Convert demurraged to inflationary
      const estimatedLiquidity = await this.convertDemurrageToInflationary(
        target.erc20tokenAddress,
        maxTransferableAmount,
      );

      if (this.logActivity) {
        await this.logLiquidityEstimate({
          sourceAvatar: source.avatar,
          targetAvatar: target.avatar,
          sourceToken: source.erc20tokenAddress,
          targetToken: target.erc20tokenAddress,
          liquidity: estimatedLiquidity,
        });
      }

      return estimatedLiquidity;
    } catch (error) {
      console.error("Error in getSimulatedLiquidity:", error);
      return 0n;
    }
  }

  /**
   * @notice Updates trust relationships with the bouncer organization for specified addresses
   * @param toTokens address to establish trust with
   * @return {Promise<boolean>} Returns true if rust relationships is successfully established
   */
  private async updateMiddlewareTrust(tokenAvatar: string): Promise<boolean> {
    try {
      // Check if trust already exists
      const isTrusted = await hubV2Contract.isTrusted(
        middlewareAddress,
        tokenAvatar,
      );

      if (!isTrusted) {
        const tx = await middlewareContract.forceTrust(tokenAvatar);
        await tx.wait();
        console.log(`Middleware forceTrusted: ${tokenAvatar}`);
      }

      return true;
    } catch (error) {
      console.error("Error updating middleware trust:", error);
      return false;
    }
  }

  private async getCurrentBackers(): Promise<string[]> {
    try {
      const balanceQuery = `
      SELECT
        "backer"
      FROM "CrcV2_CirclesBackingCompleted"
    `;

      const balanceResult = await this.client.query(balanceQuery);
      // Extract unique backer addresses from the query result
      return balanceResult.rows.map((row) => row.backer);
    } catch (error) {
      console.error("Error fetching backers:", error);
      return [];
    }
  }

  private async getBaseGroups(): Promise<BaseGroupRow[]> {
    try {
      const query = `
          SELECT
            "group",
            "mintHandler"
          FROM "CrcV2_BaseGroupCreated"
        `;

      const result = await this.client.query(query);
      return result.rows.map((row) => ({
        address: row.group,
        mintHandler: row.mintHandler,
      }));
    } catch (error) {
      console.error("Error fetching base groups:", error);
      return [];
    }
  }

  // @todo: We need to add groups to this!
  public async loadNodes(limit?: number): Promise<CirclesNode[]> {
    const nodes: CirclesNode[] = [];

    // we first get individual CRCs that are backers
    const backerAddresses = await this.getCurrentBackers();
    for (const backerAddress of backerAddresses) {
      // const isGroup = await this.checkIsGroup(backerAddress as string);
      const tokenAddress = await this.getERC20Token(backerAddress);
      const node: CirclesNode = {
        avatar: backerAddress as Address,
        isGroup: false,
        erc20tokenAddress: tokenAddress! as Address, // we know the tokenAddress must exist, since backing requires wrapping.
        lastUpdated: Date.now(),
      };
      nodes.push(node);
    }

    // we then simply load all basegroups with an ERC20 token (as I currently don't have a simple way to tell which ones have liquidity)
    const baseGroups = await this.getBaseGroups();
    for (const group of baseGroups) {
      // const isGroup = await this.checkIsGroup(group as string);
      const tokenAddress = await this.getERC20Token(group.address);
      if (!tokenAddress) continue;
      const node: CirclesNode = {
        avatar: group.address,
        isGroup: true,
        erc20tokenAddress: tokenAddress as Address,
        mintHandler: group.mintHandler,
        lastUpdated: Date.now(),
      };
      nodes.push(node);
    }
    if (limit) return nodes.slice(0, limit);
    return nodes;
  }

  // @dev: function for fetching a historical Price (currently) dummy because no such data source exists.
  public async fetchLatestPrices(
    tokenAddresses: string[],
  ): Promise<Map<string, LatestPriceRow | null>> {
    try {
      // Query to get the latest entry for each token where inputtoken is the quote reference token
      const query = `
        WITH LatestQuotes AS (
          SELECT
            outputtoken,
            inputamountraw,
            outputamountraw,
            timestamp,
            ROW_NUMBER() OVER (
              PARTITION BY outputtoken
              ORDER BY timestamp DESC
            ) as rn
          FROM quotes
          WHERE
            outputtoken = ANY($1)
            AND inputtoken = $2
            AND inputamountraw IS NOT NULL
        )
        SELECT
          outputtoken as "tokenAddress",
          inputamountraw,
          outputamountraw,
          timestamp
        FROM LatestQuotes
        WHERE rn = 1
      `;

      // Execute query with tokenAddresses and quoting token address
      const result = await this.loggerClient.query(query, [
        tokenAddresses,
        this.quotingToken.address,
      ]);

      const priceMap = new Map<string, LatestPriceRow | null>();

      // Initialize all addresses with null
      tokenAddresses.forEach((address) => {
        priceMap.set(address, null);
      });

      // Update prices where found
      result.rows.forEach((row) => {
        priceMap.set(row.tokenAddress, {
          price: BigInt(row.inputamountraw),
          timestamp: Number(row.timestamp),
        });
      });

      return priceMap;
    } catch (error) {
      console.error("Error fetching latest prices:", error);
      return new Map();
    }
  }

  // private async checkIsGroup(address: string): Promise<boolean> {
  //   return await hubV2Contract.isGroup(address);
  // }

  public async getERC20Token(avatarAddress: string): Promise<string | null> {
    const tokenWrapperContract = new Contract(
      erc20LiftAddress,
      erc20LiftAbi,
      provider,
    );
    const tokenAddress = await tokenWrapperContract.erc20Circles(
      DemurragedVSInflation,
      avatarAddress,
    );

    if (tokenAddress === ethers.ZeroAddress) {
      return null;
    }
    return tokenAddress.toLowerCase();
  }

  /**
   * @notice Retrieves the bot's ERC20 token balance.
   * @param tokenAddress The address of the ERC20 token.
   * @return {Promise<bigint>} A promise that resolves to the token balance as a bigint.
   */
  public async getTradingTokenBalance(): Promise<bigint> {
    return await this.getBotERC20Balance(this.tradingToken.address);
  }

  public async getBotERC20Balance(tokenAddress: Address): Promise<bigint> {
    // Create a contract instance for the token
    const tokenContract = new Contract(tokenAddress, erc20Abi, provider);

    // Fetch the balance
    let balance = await tokenContract.balanceOf(wallet.address);
    return balance;
  }

  public async getSpotPrice(tokenAddress: Address): Promise<Swap | null> {
    const targetToken = new Token(
      chainId,
      tokenAddress as Address,
      18,
      "Target Token",
    );

    return this.fetchBalancerQuote({
      tokenIn: this.quotingToken,
      tokenOut: targetToken,
      direction: Direction.BUY,
      amount: this.quoteReferenceAmount,
      logQuote: this.logActivity,
    });
  }

  public async getBotERC20BalanceWithRetry(
    tokenAddress: Address,
    maxRetries: number = 5,
    delayMs: number = 2000,
  ): Promise<bigint> {
    for (let i = 0; i < maxRetries; i++) {
      const balance = await this.getBotERC20Balance(tokenAddress);
      if (balance > 0n) {
        return balance;
      }
      console.log(
        `Attempt ${i + 1}: Balance still 0, waiting ${delayMs}ms before retry...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return 0n;
  }

  public async getTradingQuote(params: {
    tokenAddress: Address;
    direction: Direction;
    amount: bigint;
  }): Promise<Swap | null> {
    const targetToken = new Token(
      chainId,
      params.tokenAddress as Address,
      18,
      "Target Token",
    );

    let tokenIn;
    let tokenOut;
    if (params.direction == Direction.BUY) {
      tokenIn = this.tradingToken;
      tokenOut = targetToken;
    } else if (params.direction == Direction.SELL) {
      tokenIn = targetToken;
      tokenOut = this.tradingToken;
    } else {
      console.error("ERROR: Unknown trade direction requested");
      return null;
    }

    return this.fetchBalancerQuote({
      tokenIn: tokenIn,
      tokenOut: tokenOut,
      direction: params.direction,
      amount: params.amount,
      logQuote: false, // we're only collecting price quotes for the quote reference token
    });
  }

  /**
   * @notice Logs a trade opportunity to the database
   * @param tradeOpportunity The trade opportunity to log
   */
  public async logTradeOpportunity(params: {
    buyToken: string;
    sellToken: string;
    referenceToken: string;
    buyAmount: bigint;
    intermediateAmount: bigint;
    sellAmount: bigint;
    estimatedProfit: bigint;
  }): Promise<void> {
    try {
      const logValues = [
        Math.floor(Date.now() / 1000),
        params.buyToken,
        params.sellToken,
        params.referenceToken,
        params.buyAmount.toString(),
        params.intermediateAmount.toString(),
        params.sellAmount.toString(),
        params.estimatedProfit.toString(),
      ];
      await this.loggerClient.query(logTradeInsertQuery, logValues);
    } catch (error) {
      console.error("Error logging trade opportunity:", error);
    }
  }

  public async logLiquidityEstimate(params: {
    sourceAvatar: string;
    targetAvatar: string;
    sourceToken: string;
    targetToken: string;
    liquidity: bigint;
  }): Promise<void> {
    try {
      const logValues = [
        Math.floor(Date.now() / 1000),
        params.sourceAvatar,
        params.targetAvatar,
        params.sourceToken,
        params.targetToken,
        params.liquidity.toString(),
      ];
      await this.loggerClient.query(logLiquidityEstimateQuery, logValues);
    } catch (error) {
      console.error("Error logging liquidity estimate:", error);
    }
  }

  /**
   * @notice Fetches the latest Balancer swap quote for a token.
   * @param tokenAddress The token address to get a quote for.
   * @param amountOut The output amount for the swap.
   * @return {Promise<Swap | null>} A promise that resolves to a Swap object if a valid path is found, or null otherwise.
   */
  private async fetchBalancerQuote({
    tokenIn,
    tokenOut,
    direction,
    amount,
    logQuote = this.logActivity,
  }: FetchBalancerQuoteParams): Promise<Swap | null> {
    let swapKind: SwapKind;
    let swapAmount: TokenAmount;
    if (direction == Direction.BUY) {
      swapKind = SwapKind.GivenOut;
      swapAmount = TokenAmount.fromRawAmount(tokenOut, amount);
    } else if (direction == Direction.SELL) {
      swapKind = SwapKind.GivenIn;
      swapAmount = TokenAmount.fromRawAmount(tokenIn, amount);
    } else {
      console.error("ERROR: Unknown trade direction requested");
      return null;
    }

    const pathInput = {
      chainId,
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      swapKind: swapKind,
      swapAmount: swapAmount,
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
          tokenIn.address,
          tokenOut.address,
          null,
          amount.toString(),
        ];
        await this.loggerClient.query(logQuoteInsertQuery, logValues);
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

    if (logQuote) {
      const logValues = [
        Math.floor(Date.now() / 1000),
        tokenIn.address,
        tokenOut.address,
        swap.inputAmount.amount.toString(),
        swap.outputAmount.amount.toString(),
      ];
      await this.loggerClient.query(logQuoteInsertQuery, logValues);
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

  /**
   * @notice Approves a specified token for spending by a designated operator.
   * @param tokenAddress The ERC20 token address.
   * @param operatorAddress The address to be approved.
   * @param amount The allowance amount (default is MAX_ALLOWANCE_AMOUNT).
   * @return {Promise<void>}
   */
  private async approveTokens(
    tokenAddress: string,
    operatorAddress: string,
    amount: bigint,
  ) {
    const groupTokenContract = new Contract(tokenAddress, erc20Abi, wallet);
    const approveTx = await groupTokenContract.approve(operatorAddress, amount);
    await approveTx.wait();
  }

  public async getPathfinderTransferData(params: {
    from: CirclesNode;
    to: CirclesNode;
    requestedAmount: bigint;
  }) {
    try {
      // we assume that the max flow from the deal findingis still uptodate
      // so we don't actually update this here.
      console.log("is group: ", params.to.isGroup);
      const toAddress = params.to.isGroup
        ? params.to.mintHandler!
        : middlewareAddress;
      const toTokens = params.to.isGroup ? undefined : [params.to.avatar];

      if (!params.to.isGroup) {
        console.log("Forcing trust for ", params.to.avatar);
        const trustUpdated = await this.updateMiddlewareTrust(params.to.avatar);
        if (!trustUpdated) {
          console.log("Failed to update middleware trust relationships");
          return null;
        }
      }

      const maxHolder = await this.getMaxHolder(params.from.avatar);

      const buildPath = await this.sdk.v2Pathfinder.getPath(
        maxHolder,
        toAddress,
        params.requestedAmount,
        false,
        [params.from.avatar],
        toTokens,
      );

      //console.log("Max flow smaller than the required amount");
      //if(BigInt(buildPath.maxFlow) < BigInt(params.requestedAmount)) return null;

      const theFlow = this.sdk.v2Pathfinder.createFlowMatrix(
        middlewareAddress,
        middlewareAddress,
        buildPath.maxFlow,
        buildPath.transfers.map((transfer: any) => {
          return {
            from:
              transfer.from == maxHolder ? middlewareAddress : transfer.from,
            to: transfer.to,
            tokenOwner: transfer.tokenOwner,
            value: transfer.value,
          };
        }),
      );

      return theFlow;
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error("Error in flowData generation:", error.message);
      } else {
        console.error("Error in flowData generation:", error);
      }
      return null;
    }
  }

  /**
   * Constructs the input parameters for executeSequentialBatchSwaps function
   * @param {Object} buyQuote - The buy quote similar to sellQuote structure
   * @param {Object} sellQuote - The sell quote data
   */
  private constructExecutionInput(buyQuote: any, sellQuote: any) {
    // @todo fix type safety
    // Validate required parameters
    if (!buyQuote || !sellQuote) {
      throw new Error("Missing required parameters");
    }

    // Calculate deadline (1 hour from now)
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    // Construct buySwap object
    const buySwap = {
      swapKind: buyQuote.swap.swapKind, // Usually 0 for GIVEN_IN or 1 for GIVEN_OUT
      swaps: buyQuote.swap.swaps.map((swap: any) => ({
        poolId: swap.poolId,
        assetInIndex: Number(swap.assetInIndex || 0),
        assetOutIndex: Number(swap.assetOutIndex || 0),
        amount: swap.amount.toString(),
        userData: swap.userData || "0x",
      })),
      assets: buyQuote.swap.assets,
      funds: {
        sender: middlewareAddress,
        fromInternalBalance: false,
        recipient: middlewareAddress,
        toInternalBalance: false,
      },
      // Set appropriate limits based on expected amounts
      limits: buyQuote.swap.assets.map((asset: Address) => {
        // @todo add profitability to the limit
        if (asset === buyQuote.inputAmount.token.address) {
          return ((buyQuote.inputAmount.amount * 12n) / 10n).toString();
        }
        return "0";
      }),
      deadline: deadline,
    };

    // Construct sellSwap object
    const sellSwap = {
      swapKind: sellQuote.swap.swapKind,
      swaps: sellQuote.swap.swaps.map((swap: any) => ({
        poolId: swap.poolId,
        assetInIndex: Number(swap.assetInIndex || 0),
        assetOutIndex: Number(swap.assetOutIndex || 0),
        amount: swap.amount.toString(),
        userData: swap.userData || "0x",
      })),
      assets: sellQuote.swap.assets,
      funds: {
        sender: middlewareAddress,
        fromInternalBalance: false,
        recipient: middlewareAddress,
        toInternalBalance: false,
      },
      // Set appropriate limits based on expected amounts
      limits: sellQuote.swap.assets.map((asset: Address) => {
        // @todo these limits are insecure
        if (asset === sellQuote.inputAmount.token.address) {
          return sellQuote.inputAmount.amount.toString();
        }
        return "0";
      }),
      deadline: deadline,
    };

    // Construct pathFlow object - either from provided data or create a basic one
    // const pathFlow = pathFlowData || createDefaultPathFlow(buyQuote, sellQuote);

    return [
      buySwap,
      sellSwap,
      buySwap.assets.indexOf(buyQuote.outputAmount.token.address),
    ]; // @todo finish
  }

  async executeWithMiddleware(trade: Trade): Promise<boolean> {
    try {
      const middlewareContract = new Contract(
        middlewareAddress,
        middlewareAbi,
        wallet,
      );

      const demurragedAmount = await this.convertInflationaryToDemurrage(
        trade.buyNode.erc20tokenAddress,
        trade.amount,
      );

      // Prepare operateFlowMatrix Data
      const pathFlow = await this.getPathfinderTransferData({
        from: trade.buyNode,
        to: trade.sellNode,
        requestedAmount: demurragedAmount,
      });

      const [buySwapData, sellSwapData, buyAssetIndex] =
        this.constructExecutionInput(trade.buyQuote, trade.sellQuote);

      await this.approveTokens(
        trade.buyQuote.inputAmount.token.address,
        middlewareAddress,
        buySwapData.limits[0],
      );
      console.log(
        "current allowance: ",
        await this.checkAllowance(
          trade.buyQuote.inputAmount.token.address,
          wallet.address,
          middlewareAddress,
        ),
      );
      console.log(
        "bot balance:",
        await this.getBotERC20Balance(trade.buyQuote.inputAmount.token.address),
      );
      console.dir(
        {
          buyAssetIndex,
          buySwapData,
          sellSwapData,
          path: {
            flowVertices: pathFlow.flowVertices,
            flow: pathFlow.flowEdges,
            streams: pathFlow.streams,
            packedCoordinates: pathFlow.packedCoordinates,
          },
        },
        { depth: null },
      );
      //getBotERC20Balance()
      // check the current balance and the required amount
      const tx = await middlewareContract.executeSequentialBatchSwaps(
        buyAssetIndex,
        buySwapData,
        sellSwapData,
        {
          flowVertices: pathFlow.flowVertices,
          flow: pathFlow.flowEdges,
          streams: pathFlow.streams,
          packedCoordinates: pathFlow.packedCoordinates,
        },
      );

      const receipt = await tx.wait();
      console.log(receipt);
      console.log("tx finished!");
      return receipt.status === 1;
    } catch (error) {
      console.error("Trade execution failed:", error);
      return false;
    }
  }

  /**
   * @notice Checks the ERC20 token allowance for a given owner and spender.
   * @param tokenAddress The ERC20 token contract address.
   * @param ownerAddress The address owning the tokens.
   * @param spenderAddress The address allowed to spend the tokens.
   * @return {Promise<bigint>} A promise that resolves to the allowance as a bigint.
   */
  private async checkAllowance(
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string,
  ): Promise<bigint> {
    // Create a contract instance for the token
    const tokenContract = new Contract(tokenAddress, erc20Abi, provider);

    // Fetch the allowance
    const allowance = await tokenContract.allowance(
      ownerAddress,
      spenderAddress,
    );
    return allowance;
  }

  /**
   * @notice Converts an inflationary token amount to its corresponding demurrage-adjusted value.
   * @param tokenAddress The address of the inflationary token.
   * @param amount The amount to convert.
   * @return {Promise<bigint>} A promise that resolves to the converted demurrage value.
   */
  public async convertInflationaryToDemurrage(
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
  public async convertDemurrageToInflationary(
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
}
