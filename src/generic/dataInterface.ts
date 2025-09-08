import pg from "pg";
const { Client } = pg;
import WebSocket from "ws";
import { writeFileSync } from 'fs';


if (!global.WebSocket) {
  (global as any).WebSocket = WebSocket;
}

// Import ethers v6
import { ethers, Contract, Wallet } from "ethers";

import {
  BalancerApi,
  ChainId,
  SwapKind,
  Token,
  TokenAmount,
  Swap,
} from "@balancer/sdk";

import { createFlowMatrix } from '@circles-sdk/pathfinder';
import { circlesConfig, Sdk, Avatar } from "@circles-sdk/sdk";
import { PrivateKeyContractRunner } from "@circles-sdk/adapter-ethers";
import { CirclesConverter, cidV0ToUint8Array } from "@circles-sdk/utils";

import {
  BalanceRow,
  BaseGroupRow,
  CirclesNode,
  Direction,
  FetchBalancerQuoteParams,
  LatestPriceRow,
  TrustRelationRow,
  Address,
  DataInterfaceParams
} from "./interfaces/index.js";

// ABI
import {
  baseGroupAbi,
  erc20Abi,
  hubV2Abi,
  erc20LiftAbi,
  inflationaryTokenAbi,
  middlewareAbi,
  arbbotOracleAbi,
  arbbotV2Abi
} from "./abi/index.js";

import {
  DemurragedVSInflation,
  erc20LiftAddress,
  middlewareAddress,
  arbbotOracleAddress,
  arbbotV2Address,
  BALANCER_VAULT,
  MAX_ARBITRAGE_CRC_AMOUNT,
  PROFIT_THRESHOLD,
  logQuoteInsertQuery,
  logTradeInsertQuery,
  logLiquidityEstimateQuery,
  BALANCER_API_URL
} from "./helpers/constants.js";

// Global config
const rpcUrl = process.env.RPC_URL!;
const chainId = ChainId.GNOSIS_CHAIN;
const botPrivateKey = process.env.PRIVATE_KEY!;

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
const balancerApi = new BalancerApi(
  BALANCER_API_URL,
  chainId,
  {
    clientName: process.env.BALANCER_SDK_CLIENT_NAME,
    clientVersion: process.env.BALANCER_SDK_CLIENT_VERSION
  }
);

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

const middlewareContract = new Contract(
  middlewareAddress,
  middlewareAbi,
  wallet,
);

const arbbotOracle = new Contract(
  arbbotOracleAddress,
  arbbotOracleAbi,
  wallet
);
const arbbotV2 = new Contract(
  arbbotV2Address,
  arbbotV2Abi,
  wallet
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
  private tradingToQuoteRate: bigint | null = null;
  private lastRateUpdate: number = 0;
  private readonly RATE_UPDATE_INTERVAL = 60000; // 1 minute

  constructor(params: DataInterfaceParams) {
    this.client = new pg.Client({
      host: "104.199.5.198",
      port: 5432,
      database: "postgres",
      user: "circlesarbbotreadonly",
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

  // @todo improve the function to get real result
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
          WithWrap: false,
          TargetFlow: "99999999999999999999999999999999999",
        },
      ],
    };

    // const body = JSON.stringify(findPathPayload);
    // console.log("pathfinder query body: ", body);
    const response = await fetch(rpcUrl, {
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
      const estimatedLiquidity = CirclesConverter.attoCirclesToAttoStaticCircles(BigInt(maxTransferableAmount));

      if (this.logActivity) {
        await this.logLiquidityEstimate({
          sourceAvatar: source.avatar,
          targetAvatar: target.avatar,
          sourceToken: source.erc20tokenAddress,
          targetToken: target.erc20tokenAddress,
          liquidity: estimatedLiquidity,
          sourcePrice: !source.price ? null : source.price,
          targetPrice: !target.price ? null : target.price,
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
  public async updateMiddlewareTrust(tokenAvatar: string): Promise<boolean> {
    try {
      // Check if trust already exists
      const isTrusted = await hubV2Contract.isTrusted(
        arbbotV2Address,
        tokenAvatar,
      );

      if (!isTrusted) {
        const tx = await arbbotV2.forceTrust(tokenAvatar);
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
      // @todo move mintPolicy to const
      const query = `
        SELECT 
          "group",
          "mintHandler",
          "erc20WrapperStatic"
        FROM "V_CrcV2_Groups" where "erc20WrapperStatic" is not null and
          "V_CrcV2_Groups"."mintPolicy"='0xcdfc5135aec0afbf102c108e7f5c8a88c6112842' and
          "V_CrcV2_Groups"."memberCount" > 0
        `;

      const result = await this.client.query(query);
      return result.rows.map((row) => ({
        address: row.group,
        mintHandler: row.mintHandler,
        erc20tokenAddress: row.erc20WrapperStatic
      }));
    } catch (error) {
      console.error("Error fetching base groups:", error);
      return [];
    }
  }

  /**
   * Alternative version that only stores pool IDs instead of full pool objects (for memory efficiency)
   * @param {Object[]} nodes - Array of node objects with erc20tokenAddress  
   * @param {Object[]} pools - Array of pool objects from Balancer
   * @returns {Object[]} Updated nodes array with pool IDs populated
   */
  private updateNodesWithPoolIds(nodes: any, pools: any) {
    if (!nodes || !Array.isArray(nodes)) {
      console.warn('Invalid nodes array provided');
      return [];
    }
    
    if (!pools || !Array.isArray(pools)) {
      console.warn('Invalid pools array provided');
      return nodes;
    }

    console.log(`Updating ${nodes.length} nodes with pool IDs from ${pools.length} available pools`);
    // @todo move to const
    const supportedTokens: Address[] = [
      "0xaf204776c7245bF4147c2612BF6e5972Ee483701", // sDAI
      "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1", // WETH
      "0x6C76971f98945AE98dD7d4DFcA8711ebea946eA6", // wstETH
      "0x8e5bBbb09Ed1ebdE8674Cda39A0c169401db4252", // WBTC
      "0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb" // GNO
    ];
    // Convert supportedTokens to lowercase for case-insensitive comparison
    const supportedTokensLower = supportedTokens.map(token => token.toLowerCase());

    // Create a map for faster lookup: tokenAddress -> pool IDs containing that token
    const tokenToPoolIdsMap = new Map();
    
    // Build the map by iterating through all pools
    pools.forEach(pool => {
      if (pool.poolTokens && Array.isArray(pool.poolTokens)) {
        // Skip pools with more than 2 tokens
        if (pool.poolTokens.length > 2) {
          return;
        }

        // Check if at least one of the tokens is in the supported tokens list
        const hasSupprotedToken = pool.poolTokens.some((token: any) => 
          supportedTokensLower.includes(token.address.toLowerCase())
        );

        if (!hasSupprotedToken) {
          return; // Skip this pool if none of the tokens are supported
        }

        // Process the pool tokens
        pool.poolTokens.forEach((token: any) => {
          const tokenAddress = token.address.toLowerCase();
          
          if (!tokenToPoolIdsMap.has(tokenAddress)) {
            tokenToPoolIdsMap.set(tokenAddress, []);
          }
          
          // Add only the pool ID to save memory
          tokenToPoolIdsMap.get(tokenAddress).push(pool.id);
        });
      }
    });

    console.log(`Created token-to-pool-IDs mapping for ${tokenToPoolIdsMap.size} unique tokens`);

    // Update each node with matching pool IDs
    const updatedNodes = nodes.map(node => {
      if (!node.erc20tokenAddress) {
        console.warn('Node missing erc20tokenAddress:', node);
        return {
          ...node,
          pools: [],
          lastUpdated: Date.now()
        };
      }

      const tokenAddress = node.erc20tokenAddress.toLowerCase();
      const matchingPoolIds = tokenToPoolIdsMap.get(tokenAddress) || [];
      
      console.log(`Token ${node.erc20tokenAddress} found in ${matchingPoolIds.length} pools`);
      
      return {
        ...node,
        pools: matchingPoolIds
      };
    });

    // Log summary
    const totalPoolsAssigned = updatedNodes.reduce((sum, node) => sum + node.pools.length, 0);
    const nodesWithPools = updatedNodes.filter(node => node.pools.length > 0).length;
    
    console.log(`Summary: ${nodesWithPools}/${updatedNodes.length} nodes have pools assigned`);
    console.log(`Total pool assignments: ${totalPoolsAssigned}`);

    return updatedNodes;
  }

  //@todo fix types
  public async loadNodes(limit?: number): Promise<any[]> {
    const nodes: CirclesNode[] = [];
    if(process.env.ONLY_GROUPS !== "true") {
      console.log(process.env.ONLY_GROUPS)
      // we first get individual CRCs that are backers
      const backerAddresses = await this.getCurrentBackers();
      for (const backerAddress of backerAddresses) {
        // const isGroup = await this.checkIsGroup(backerAddress as string);
        const tokenAddress = await this.getERC20Token(backerAddress);

        const node: CirclesNode = {
          avatar: backerAddress as Address,
          isGroup: false,
          pools: [],
          erc20tokenAddress: tokenAddress! as Address, // we know the tokenAddress must exist, since backing requires wrapping.
          lastUpdated: Date.now(),
        };
        nodes.push(node);
      }
    }

    const baseGroups = await this.getBaseGroups();
    for (const group of baseGroups) {
      if (!group.mintHandler) {
        const mintHandler = await this.getMintHandler(group.address);
        if(!mintHandler) continue;
        group.mintHandler = mintHandler;
      };
      
      // Check if there is a group token in the balancerV2 vault
      const balancerVaultV2Balance = await this.getERC20Balance(group.erc20tokenAddress as Address, BALANCER_VAULT);
      // @todo extend support for v3 in the future
      if (!balancerVaultV2Balance) {
        continue;
      }

      const node: CirclesNode = {
        avatar: group.address,
        isGroup: true,
        pools: [],
        erc20tokenAddress: group.erc20tokenAddress as Address,
        mintHandler: group.mintHandler,
        lastUpdated: Date.now(),
      };
      nodes.push(node);

    }
    const poolsData = await this.getAllGnosisPools();
    let allNodes;
    // @todo remove duplications
    if (limit) {
      const activeNodes = nodes.slice(0, limit);
      allNodes = this.updateNodesWithPoolIds(activeNodes, poolsData);
    } else {
      allNodes = this.updateNodesWithPoolIds(nodes, poolsData);
    }
    const rest = await this.quotePricesForAllNodes(allNodes);
    this.writeJsonToFile(rest, "log.json");
    return allNodes;
  }

  
  public writeJsonToFile(data: any, filename: string): void {
    const jsonString = JSON.stringify(data, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    , 2);
    
    writeFileSync(filename, jsonString, 'utf8');
    console.log(`Saved to ${filename}`);
  }


  /**
   * Quotes prices for all nodes and returns them in the specified JSON format
   * @param nodes - Array of CirclesNode objects to quote prices for
   * @param getCurrentSpotPrice - Function that returns spot price for a node
   * @returns Promise<PriceOutput> - JSON object with prices for each token
   */
  
  private async quotePricesForAllNodes(
    nodes: CirclesNode[]
  ) {
    const priceResults = [];
    
    console.log(`Starting price quotation for ${nodes.length} nodes...`);
    
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      console.log(`Quoting price for node ${i + 1}/${nodes.length}: ${node.erc20tokenAddress}`);
      
      try {
        const price = await this.getOracleSpotPrice(node.erc20tokenAddress, node.pools?.[0] || "");
        
        // Find existing entry for this token address or create new one
        let existingResult = priceResults.find(
          result => result.erc20TokensAddress === node.erc20tokenAddress
        );
        
        if (!existingResult) {
          existingResult = {
            erc20TokensAddress: node.erc20tokenAddress,
            prices: []
          };
          priceResults.push(existingResult);
        }
        
        // Add price if it's valid (not null)
        if (price !== null) {
          existingResult.prices.push(price);
          console.log(`✓ Price found: ${price.toString()}`);
        } else {
          console.log(`⚠ No price available for ${node.erc20tokenAddress}`);
        }
        
      } catch (error) {
        console.error(`✗ Error getting price for ${node.erc20tokenAddress}:`, error);
        // Continue with next node even if this one fails
      }
      
      // Add small delay to avoid overwhelming the price oracle
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`Price quotation complete. Found prices for ${priceResults.length} unique tokens.`);
    
    return {
      prices: priceResults
    };
  }

  public async fetchLatestLiquidityEstimates(): Promise<
    Map<string, { liquidity: bigint; timestamp: number }>
  > {
    try {
      const query = `
        WITH LatestEstimates AS (
          SELECT
            source_avatar,
            target_avatar,
            liquidity,
            timestamp,
            ROW_NUMBER() OVER (
              PARTITION BY source_avatar, target_avatar
              ORDER BY timestamp DESC
            ) as rn
          FROM liquidity_estimates
        )
        SELECT
          source_avatar,
          target_avatar,
          liquidity,
          EXTRACT(EPOCH FROM timestamp) as timestamp
        FROM LatestEstimates
        WHERE rn = 1
      `;

      const result = await this.loggerClient.query(query);

      const liquidityMap = new Map<
        string,
        { liquidity: bigint; timestamp: number }
      >();
      result.rows.forEach((row) => {
        const key = `${row.source_avatar}-${row.target_avatar}`;
        liquidityMap.set(key, {
          liquidity: BigInt(row.liquidity),
          timestamp: Math.floor(Number(row.timestamp) * 1000), // Convert to milliseconds
        });
      });

      return liquidityMap;
    } catch (error) {
      console.error("Error fetching latest liquidity estimates:", error);
      return new Map();
    }
  }

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

  public async getMintHandler(group: Address): Promise<Address | null> {
    const groupContract = new Contract(
      group,
      baseGroupAbi,
      provider,
    );
    try {
      const mintHandler = await groupContract.BASE_MINT_HANDLER.staticCall();
      if (mintHandler === ethers.ZeroAddress) {
        return null;
      }
      return mintHandler.toLowerCase();
    } catch {
      return null;
    }
  }


  /**
   * @notice Retrieves the bot's ERC20 token balance.
   * @param tokenAddress The address of the ERC20 token.
   * @return {Promise<bigint>} A promise that resolves to the token balance as a bigint.
   */
  public async getTradingTokenBalance(): Promise<bigint> {
    return await this.getERC20Balance(this.tradingToken.address as Address, wallet.address as Address);
  }

  public async getERC20Balance(tokenAddress: Address, holder: Address): Promise<bigint> {
    // Create a contract instance for the token
    const tokenContract = new Contract(tokenAddress, erc20Abi, provider);

    // Fetch the balance
    let balance = await tokenContract.balanceOf(holder);
    return balance;
  }
  public async getTradeCalculation(
    token1: Address,
    pool1: string,
    token2: Address,
    pool2: string,
    amount: bigint
  ) { // @todo add typescript support

    const executionData = await arbbotOracle.checkCRCArbitrage.staticCall(
      token1,
      pool1,
      token2,
      pool2,
      amount
    );
    
    return executionData;
  }

  public async getOracleSpotPrice(tokenAddress: Address, poolId: string): Promise<bigint> {
    console.log(tokenAddress, poolId)
    const amount = await arbbotOracle.getSwapQuoteToDAI.staticCall(tokenAddress, poolId, BigInt(1e18));
    return amount;
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


  public async logLiquidityEstimate(params: {
    sourceAvatar: string;
    targetAvatar: string;
    sourceToken: string;
    targetToken: string;
    liquidity: bigint;
    sourcePrice: bigint | null;
    targetPrice: bigint | null;
  }): Promise<void> {
    try {
      const logValues = [
        Math.floor(Date.now() / 1000),
        params.sourceAvatar,
        params.targetAvatar,
        params.sourceToken,
        params.targetToken,
        params.liquidity.toString(),
        params.sourcePrice?.toString(),
        params.targetPrice?.toString(),
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
    skipSwapCallPreparation = false
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
        console.error("ERROR: Swap path not found: ");
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
      console.log("No swap path found");
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

    if(skipSwapCallPreparation) return swap;

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

  public async getPathfinderTransferData(
    from: CirclesNode,
    to: CirclesNode,
    amount: bigint = MAX_ARBITRAGE_CRC_AMOUNT, // @todo move to const
    onlyMaxFlow: boolean = false
  ) {
    try {
      // we assume that the max flow from the deal findingis still uptodate
      // so we don't actually update this here.
      const toAddress = to.isGroup
        ? to.mintHandler!
        : arbbotV2Address;
      const toTokens = to.isGroup ? undefined : [to.avatar];

      if (!to.isGroup) {
        console.log("Forcing trust for ", to.avatar);
        // @todo rework logic to trust during the sc call
        const trustUpdated = await this.updateMiddlewareTrust(to.avatar);
        if (!trustUpdated) {
          console.log("Failed to update middleware trust relationships");
          return null;
        }
      }
      const maxHolder = await this.getMaxHolder(from.avatar);
      console.log(
        "pathfinder args",
        maxHolder,
        toAddress,
        amount,
        false,
        [from.avatar],
        toTokens
      )

      const buildPath = await this.sdk.v2Pathfinder.getPath(
        maxHolder,
        toAddress,
        amount.toString(),
        false,
        [from.avatar],
        toTokens,
      );

      if(onlyMaxFlow) {
        return !buildPath.maxFlow ? 0n : buildPath.maxFlow;
      }

      const theFlow = createFlowMatrix(
        arbbotV2Address,
        toAddress,
        buildPath.maxFlow,
        buildPath.transfers.map((transfer: any) => {
          return {
            from:
              transfer.from == maxHolder ? arbbotV2Address : transfer.from,
            to: transfer.to,
            tokenOwner: transfer.tokenOwner,
            value: transfer.value,
          };
        }),
      );

      return theFlow;
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error("Error in flowData generation:", error);
      } else {
        console.error("Error in flowData generation:", error);
      }
      return null;
    }
  }

  // @todo add checks like enough liquidity etc
  async executeWithV2(
    buyNode: CirclesNode,
    sellNode: CirclesNode,
    requiredEth: bigint,
    crcAmount: bigint
  ) {
    const demurragedAmount = CirclesConverter.attoStaticCirclesToAttoCircles(crcAmount);
    const pathFlow = await this.getPathfinderTransferData(
      buyNode,
      sellNode,
      demurragedAmount,
    );
    console.log("execution data");
    console.log(requiredEth, demurragedAmount);
    console.dir(pathFlow, {depth: null});

    // @todo check which of conversion is redundunt

    const arbTx = await arbbotV2.executeArbitrageWithFlashLoan(
      buyNode.erc20tokenAddress,
      buyNode.pools?.[0],
      sellNode.erc20tokenAddress,
      sellNode.pools?.[0],
      demurragedAmount,
      requiredEth * BigInt(101) / BigInt(100), // @todo add slight slippage
      {
        flowVertices: pathFlow.flowVertices,
        flow: pathFlow.flowEdges,
        streams: pathFlow.streams,
        packedCoordinates: pathFlow.packedCoordinates,
      },
      // @todo move to const
      "0x0Bb4C6414e0d566d0F5cbEa10Ca695Dd9A3FFb97"
    );
    const recipt = await arbTx.wait();
    console.log(recipt);
    return true;
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
   * Get all pools on Gnosis chain in batches
   * @returns {Promise<Object[]>} Promise resolving to array of all pool objects
   */
  // @todo update function to filter out tokens if there is no path set for such contracts
  public async getAllGnosisPools() {
    const BATCH_SIZE = 1000;
    const allPools = [];
    
    try {
      // First, get the total count of pools
      const totalCount = await this.getGnosisPoolsCount();
      console.log(`Total pools to fetch: ${totalCount}`);
      
      // Calculate number of batches needed
      const totalBatches = Math.ceil(totalCount / BATCH_SIZE);
      console.log(`Fetching pools in ${totalBatches} batches of ${BATCH_SIZE}`);
      
      // Fetch pools in batches
      for (let batch = 0; batch < totalBatches; batch++) {
        const skip = batch * BATCH_SIZE;
        console.log(`Fetching batch ${batch + 1}/${totalBatches} (skip: ${skip}, first: ${BATCH_SIZE})`);
        
        const batchPools = await this.getGnosisPoolsBatch(BATCH_SIZE, skip);
        allPools.push(...batchPools);
        
        // Optional: Add a small delay between requests to be respectful to the API
        if (batch < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      console.log(`Successfully fetched ${allPools.length} pools`);
      return allPools;
      
    } catch (error) {
      console.error('Error fetching all Gnosis pools:', error);
      throw error;
    }
  }

  /**
   * Get the total count of pools on Gnosis chain
   * @returns {Promise<number>} Promise resolving to total pool count
   */
  private async getGnosisPoolsCount() {
    const query = `
      query GetGnosisPoolsCount {
        poolGetPoolsCount(
          where: {
            chainIn: [GNOSIS]
            protocolVersionIn: [2]
          }
        ) 
      }
    `;
    
    try {
      const response = await fetch(BALANCER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.errors) {
        throw new Error(`GraphQL error: ${result.errors[0].message}`);
      }
      
      return result.data.poolGetPoolsCount;
      
    } catch (error) {
      console.error('Error fetching pool count:', error);
      throw error;
    }
  }

  /**
   * Get a batch of pools from Gnosis chain
   * @param {number} first - Number of pools to fetch
   * @param {number} skip - Number of pools to skip
   * @returns {Promise<Object[]>} Promise resolving to array of pool objects
   */
  private async getGnosisPoolsBatch(first: number, skip: number) {
    const query = `
      query GetGnosisPools($first: Int!, $skip: Int!) {
        poolGetPools(
          where: {
            chainIn: [GNOSIS]
            protocolVersionIn: [2]
          }
          first: $first
          skip: $skip
          orderBy: totalLiquidity
          orderDirection: desc
        ) {
          id
          address
          name
          symbol
          type
          dynamicData {
            totalLiquidity
            volume24h
          }
          poolTokens {
            address
            symbol
            name
            balance
            weight
            decimals
          }
        }
      }
    `;
    
    try {
      const response = await fetch(BALANCER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: {
            first,
            skip
          }
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.errors) {
        throw new Error(`GraphQL error: ${result.errors[0].message}`);
      }
      
      return result.data.poolGetPools;
      
    } catch (error) {
      console.error('Error fetching pool batch:', error);
      throw error;
    }
  }
}
