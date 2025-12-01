import pg from "pg";
const { Client } = pg;
import WebSocket from "ws";

if (!global.WebSocket) {
  (global as any).WebSocket = WebSocket;
}

// Import viem
import { createPublicClient, http, type Hex, bytesToHex } from "viem";
import { gnosis } from "viem/chains";

// Import Balancer SDK
import {
  BalancerApi,
  ChainId,
  SwapKind,
  Token,
  TokenAmount,
  Swap,
} from "@balancer/sdk";

// Import new Circles SDK
import { circlesConfig, Core } from '@aboutcircles/sdk-core';
import { CirclesConverter } from '@aboutcircles/sdk-utils';
import { CirclesRpc } from '@aboutcircles/sdk-rpc';
import { createFlowMatrix } from '@aboutcircles/sdk-pathfinder';
import type { Address } from '@aboutcircles/sdk-types';
import { PrivateKeyContractRunner } from './helpers/runner';


import {
  BalanceRow,
  BaseGroupRow,
  CirclesNode,
  Direction,
  FetchBalancerQuoteParams,
  LatestPriceRow,
  TrustRelationRow,
  DataInterfaceParams,
  BalancerPool,
  PriceResult,
  QuotePricesResult
} from "./interfaces";
// Import contract wrappers
import {
  ArbbotOracleContract,
  ArbbotV2Contract,
  BaseGroupContract,
  ERC20LiftContract,
  ERC20Contract,
  InflationaryTokenContract,
  BaseGroupMintRouterContract,
} from './helpers/contracts';

import {
  DemurragedVSInflation,
  erc20LiftAddress,
  arbbotOracleAddress,
  arbbotV2Address,
  baseGroupMintRouterAddress,
  BALANCER_VAULT,
  MAX_ARBITRAGE_CRC_AMOUNT,
  PROFIT_THRESHOLD,
  supportedTokens,
  BALANCER_API_URL,
  getNextSnapshotIdQuery,
  logPriceSnapshotQuery,
  logLiquidityObservationQuery,
  getBalancesQuery,
  getTrustRelationsQuery,
  getCurrentBackersQuery,
  getBaseGroupsQuery,
  fetchLatestLiquidityEstimatesQuery,
  getGnosisPoolsCountQuery,
  getGnosisPoolsBatchQuery
} from "./helpers/constants";

// Global config
const rpcUrl = process.env.RPC_URL!;
const chainId = ChainId.GNOSIS_CHAIN;
const botPrivateKey = process.env.PRIVATE_KEY! as Hex;

/**
 * @notice Initializes core blockchain objects using viem
 */
const publicClient = createPublicClient({
  chain: gnosis,
  transport: http(rpcUrl),
});

export class DataInterface {
  private client: pg.Client;
  private loggerClient: pg.Client;
  public quoteReferenceAmount: bigint;
  public quotingToken: Token;
  public logActivity: boolean;
  public runner?: PrivateKeyContractRunner;
  public core?: Core;
  public rpc?: CirclesRpc;
  public arbbotOracle?: ArbbotOracleContract;
  public arbbotV2?: ArbbotV2Contract;
  public liftERC20?: ERC20LiftContract;
  public baseGroupMintRouter?: BaseGroupMintRouterContract;
  private tradingToQuoteRate: bigint | null = null;
  private lastRateUpdate: number = 0;
  private readonly RATE_UPDATE_INTERVAL = 60000; // 1 minute

  constructor(params: DataInterfaceParams) {
    this.client = new pg.Client({
      host: "34.140.234.215",
      port: 5432,
      database: "postgres",
      user: "circlesarbbotreadonly",
      password: process.env.POSTGRESQL_PW,
      ssl: {
        rejectUnauthorized: false,
      },
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

    this.quotingToken = new Token(
      chainId,
      params.quotingToken,
      Number(params.collateralTokenDecimals),
      "Quote Token",
    );

    this.logActivity = params.logActivity;
  }

  async init(): Promise<void> {
    // Initialize runner
    this.runner = new PrivateKeyContractRunner(
      //@ts-ignore
      publicClient,
      botPrivateKey,
      rpcUrl
    );
    await this.runner.init();

    // Initialize Core SDK
    this.core = new Core();

    // Initialize RPC for pathfinder
    this.rpc = new CirclesRpc('https://rpc.circlesubi.network/');

    // Initialize custom contracts
    this.arbbotOracle = new ArbbotOracleContract({
      address: arbbotOracleAddress,
      rpcUrl,
    });

    this.arbbotV2 = new ArbbotV2Contract({
      address: arbbotV2Address,
      rpcUrl,
    });

    this.liftERC20 = new ERC20LiftContract({
      address: erc20LiftAddress,
      rpcUrl,
    });

    this.baseGroupMintRouter = new BaseGroupMintRouterContract({
      address: "0xF30ef9966DeECA19359ae6014F43Fadddd5D74c6",
      rpcUrl,
    });

    // Connect to database
    await this.client
      .connect()
      .then(() => {
        console.log("Connected to PostgreSQL database");
      })
      .catch((err) => {
        console.error("Error connecting to PostgreSQL database", err);
      });

    await this.loggerClient
      .connect()
      .then(() => {
        console.log("Connected to Logger database");
      })
      .catch((err) => {
        console.error("Error connecting to Logger database", err);
    });

    console.log("Loading bot avatar with address ", this.runner.address);
  }

  async cleanup(): Promise<void> {
    await this.client.end();
    await this.loggerClient.end();
  }

  /**
   * Get the next snapshot ID for price snapshots
   */
  public async getNextSnapshotId(): Promise<number> {
    if (!this.logActivity) {
      return 1;
    }
    try {
      const result = await this.loggerClient.query(getNextSnapshotIdQuery);
      return result.rows[0].next_id;
    } catch (error) {
      console.error("Error getting next snapshot ID:", error);
      return 1;
    }
  }

  /**
   * Insert a price snapshot record
   */
  public async insertPriceSnapshot(
    snapshotId: number,
    token: Address,
    poolId: string,
    poolType: string,
    price: bigint,
    refToken: Address,
    swapAmount: bigint
  ): Promise<void> {
    if (!this.logActivity) {
      return;
    }
    try {
      const timestamp = Date.now() / 1000;
      await this.loggerClient.query(
        logPriceSnapshotQuery,
        [
          snapshotId,
          token.toLowerCase(),
          poolId,
          poolType,
          price.toString(),
          refToken.toLowerCase(),
          swapAmount.toString(),
          timestamp
        ]
      );
    } catch (error) {
      console.error(`Error inserting price snapshot for ${token}:`, error);
    }
  }

  /**
   * Log a liquidity observation for analysis
   */
  public async logLiquidityObservation(observation: {
    source_avatar: Address;
    target_avatar: Address;
    measured_liquidity: bigint;
    required_amount: bigint;
    edge_id?: string;
    edge_score?: bigint;
    success: boolean;
    source_token_price?: bigint;
    target_token_price?: bigint;
    ref_token?: Address;
  }): Promise<void> {
    if (!this.logActivity) {
      return;
    }
    try {
      const timestamp = Date.now() / 1000;
      await this.loggerClient.query(
        logLiquidityObservationQuery,
        [
          timestamp,
          observation.source_avatar.toLowerCase(),
          observation.target_avatar.toLowerCase(),
          observation.measured_liquidity.toString(),
          observation.required_amount.toString(),
          observation.edge_id || null,
          observation.edge_score?.toString() || null,
          observation.success,
          observation.source_token_price?.toString() || null,
          observation.target_token_price?.toString() || null,
          observation.ref_token?.toLowerCase() || null
        ]
      );
    } catch (error) {
      console.error(
        `Error logging liquidity observation for ${observation.source_avatar} -> ${observation.target_avatar}:`,
        error
      );
    }
  }

  public async getBalances(tokens: string[]): Promise<BalanceRow[]> {
    try {
      const result = await this.client.query(getBalancesQuery, [
        tokens.map((address) => address.toLowerCase()),
      ]);
      return result.rows.map((row) => ({
        account: row.account,
        demurragedTotalBalance: BigInt(row.demurragedTotalBalance),
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
      let query = getTrustRelationsQuery;
      const conditions: string[] = [];
      const queryParams: string[] = [];

      if (params.trusters?.length) {
        let trusters = params.trusters.map((truster) => truster.toLowerCase());
        queryParams.push(`{${trusters.join(",")}}`);
        conditions.push(`"truster" = ANY($${queryParams.length})`);
      }

      if (params.trustees?.length) {
        let trustees = params.trustees.map((trustee) => trustee.toLowerCase());
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

  public async getMaxTransferableAmount(params: {
    from: Address;
    to: Address;
    fromTokens?: Address[];
    toTokens?: Address[];
  }): Promise<bigint> {
    const path = await this.rpc!.pathfinder.findPath({
      from: params.from,
      to: params.to,
      fromTokens: params.fromTokens,
      toTokens: params.toTokens,
      useWrappedBalances: false,
      targetFlow: 99999999999999999999999999999999999n,
      maxTransfers: 100,
    });

    return BigInt(path.maxFlow);
  }

  private async getCurrentBackers(): Promise<string[]> {
    try {
      const balanceResult = await this.client.query(getCurrentBackersQuery);
      return balanceResult.rows.map((row) => row.backer);
    } catch (error) {
      console.error("Error fetching backers:", error);
      return [];
    }
  }

  private async getBaseGroups(): Promise<BaseGroupRow[]> {
    try {
      const result = await this.client.query(getBaseGroupsQuery);
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
  // Update nodes with Balancer V2 pool ids
  private updateNodesWithPoolIds(nodes: CirclesNode[], pools: BalancerPool[]): CirclesNode[] {
    if (!nodes || !Array.isArray(nodes)) {
      console.warn('Invalid nodes array provided');
      return [];
    }

    if (!pools || !Array.isArray(pools)) {
      console.warn('Invalid pools array provided');
      return nodes;
    }

    console.log(`Updating ${nodes.length} nodes with pool IDs from ${pools.length} available pools`);

    const supportedTokensLower = supportedTokens.map(token => token.toLowerCase());
    const tokenToPoolIdsMap = new Map();

    pools.forEach(pool => {
      if (pool.poolTokens && Array.isArray(pool.poolTokens)) {
        if (pool.poolTokens.length > 2) {
          return;
        }

        const hasSupprotedToken = pool.poolTokens.some((token: any) =>
          supportedTokensLower.includes(token.address.toLowerCase())
        );

        if (!hasSupprotedToken) {
          return;
        }

        pool.poolTokens.forEach((token: any) => {
          const tokenAddress = token.address.toLowerCase();

          if (!tokenToPoolIdsMap.has(tokenAddress)) {
            tokenToPoolIdsMap.set(tokenAddress, []);
          }

          tokenToPoolIdsMap.get(tokenAddress).push(pool.id);
        });
      }
    });

    console.log(`Created token-to-pool-IDs mapping for ${tokenToPoolIdsMap.size} unique tokens`);

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

    const totalPoolsAssigned = updatedNodes.reduce((sum, node) => sum + node.pools.length, 0);
    const nodesWithPools = updatedNodes.filter(node => node.pools.length > 0).length;

    console.log(`Summary: ${nodesWithPools}/${updatedNodes.length} nodes have pools assigned`);
    console.log(`Total pool assignments: ${totalPoolsAssigned}`);

    return updatedNodes;
  }

  public async loadNodes(limit?: number): Promise<CirclesNode[]> {
    const nodes: CirclesNode[] = [];
    if(process.env.ONLY_GROUPS !== "true") {
      const backerAddresses = await this.getCurrentBackers();
      for (const backerAddress of backerAddresses) {
        const tokenAddress = await this.getERC20Token(backerAddress);

        const node: CirclesNode = {
          avatar: backerAddress as Address,
          isGroup: false,
          pools: [],
          erc20tokenAddress: tokenAddress! as Address,
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

      const balancerVaultV2Balance = await this.getERC20Balance(group.erc20tokenAddress as Address, BALANCER_VAULT);
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
    const nodesToProcess = limit ? nodes.slice(0, limit) : nodes;
    const allNodes = this.updateNodesWithPoolIds(nodesToProcess, poolsData);

    return allNodes;
  }
  public async fetchLatestLiquidityEstimates(): Promise<
    Map<string, { liquidity: bigint; timestamp: number }>
  > {
    try {
      const result = await this.loggerClient.query(fetchLatestLiquidityEstimatesQuery);

      const liquidityMap = new Map<
        string,
        { liquidity: bigint; timestamp: number }
      >();
      result.rows.forEach((row) => {
        const key = `${row.source_avatar}-${row.target_avatar}`;
        liquidityMap.set(key, {
          liquidity: BigInt(row.measured_liquidity),
          timestamp: Math.floor(Number(row.timestamp) * 1000),
        });
      });

      return liquidityMap;
    } catch (error) {
      console.error("Error fetching latest liquidity estimates:", error);
      return new Map();
    }
  }

  /**
   * @deprecated This method is no longer used. Prices are now fetched from oracle on-demand.
   */
  public async fetchLatestPrices(
    tokenAddresses: string[],
  ): Promise<Map<string, LatestPriceRow | null>> {
    console.warn("fetchLatestPrices is deprecated. Use getOracleSpotPrice instead.");
    const priceMap = new Map<string, LatestPriceRow | null>();
    tokenAddresses.forEach((address) => {
      priceMap.set(address, null);
    });
    return priceMap;
  }

  public async getERC20Token(avatarAddress: string): Promise<string | null> {
    const tokenAddress = await this.liftERC20!.erc20Circles(
      DemurragedVSInflation,
      avatarAddress as Address,
    );

    if (tokenAddress === '0x0000000000000000000000000000000000000000') {
      return null;
    }
    return tokenAddress.toLowerCase();
  }

  public async getMintHandler(group: Address): Promise<Address | null> {
    const groupContract = new BaseGroupContract({
      address: group,
      rpcUrl,
    });

    try {
      const mintHandler = await groupContract.BASE_MINT_HANDLER();
      if (mintHandler === '0x0000000000000000000000000000000000000000') {
        return null;
      }
      return mintHandler.toLowerCase() as Address;
    } catch {
      return null;
    }
  }

  public async getERC20Balance(tokenAddress: Address, holder: Address): Promise<bigint> {
    const tokenContract = new ERC20Contract({
      address: tokenAddress,
      rpcUrl,
    });

    const balance = await tokenContract.balanceOf(holder);
    return balance;
  }

  public async getTradeCalculation(
    token1: Address,
    pool1: string,
    token2: Address,
    pool2: string,
    amount: bigint
  ) {
    const executionData = await this.arbbotOracle!.checkCRCArbitrage(
      token1,
      pool1,
      token2,
      pool2,
      amount
    );

    return executionData;
  }

  public async getOracleSpotPrice(tokenAddress: Address, poolId: string): Promise<bigint> {
    const amount = await this.arbbotOracle!.getSwapQuoteToDAI(
      tokenAddress,
      poolId,
      BigInt(1e18)
    );
    return amount;
  }

  public async getPathfinderTransferData(
    from: CirclesNode,
    to: CirclesNode,
    amount: bigint = MAX_ARBITRAGE_CRC_AMOUNT,
    onlyMaxFlow: boolean = false
  ) {
    try {
      const toAddress = to.isGroup
        ? to.mintHandler!
        : arbbotV2Address;
      const toTokens = to.isGroup ? undefined : [to.avatar];

      // Prepare simulated balance for the arbbot middleware instance
      const simulatedBalances = [
        {
          holder: arbbotV2Address as Address,
          token: from.avatar,
          amount: amount,
          isWrapped: false,
          isStatic: false
        }
      ];

      // Prepare simulated trust if not a group (simulate that arbbot trusts the to.avatar)
      const simulatedTrusts = !to.isGroup ? [
        {
          truster: arbbotV2Address as Address,
          trustee: to.avatar
        }
      ] : undefined;

      console.log(
        "pathfinder args",
        arbbotV2Address,
        toAddress,
        amount,
        false,
        [from.avatar],
        toTokens
      )

      const buildPath = await this.rpc!.pathfinder.findPath({
        from: arbbotV2Address,
        to: toAddress,
        targetFlow: BigInt(amount),
        useWrappedBalances: false,
        fromTokens: [from.avatar],
        toTokens: toTokens,
        simulatedBalances: simulatedBalances,
        simulatedTrusts: simulatedTrusts,
        maxTransfers: 100,
      });

      if(onlyMaxFlow) {
        return !buildPath.maxFlow ? 0n : BigInt(buildPath.maxFlow);
      }

      // Extract unique token owners from transfers going TO the organization and enable trust for them on the router
      const ORG_ADDRESS = baseGroupMintRouterAddress.toLowerCase();
      const NEW_ROUTER_ADDRESS = "0xF30ef9966DeECA19359ae6014F43Fadddd5D74c6" as Address;
      if (buildPath.transfers && buildPath.transfers.length > 0) {

        const uniqueTokenOwners = new Set<Address>();

        buildPath.transfers.forEach((transfer: any) => {
          // Only include tokens being sent TO the organization
          if (transfer.to && transfer.to.toLowerCase() === ORG_ADDRESS && transfer.tokenOwner) {
            uniqueTokenOwners.add(transfer.tokenOwner as Address);
          }
        });

        if (uniqueTokenOwners.size > 0) {
          const allTokenOwners = Array.from(uniqueTokenOwners);
          console.log(`Checking trust status for ${allTokenOwners.length} tokens...`);

          // Filter out tokens that are already trusted by the router
          const untrustedTokens: Address[] = [];
          for (const tokenOwner of allTokenOwners) {
            const isTrusted = await this.core!.hubV2.isTrusted(
              NEW_ROUTER_ADDRESS,
              tokenOwner
            );
            if (!isTrusted) {
              untrustedTokens.push(tokenOwner);
            } else {
              console.log(`Token ${tokenOwner} is already trusted, skipping`);
            }
          }

          if (untrustedTokens.length > 0) {
            console.log(`Enabling trust for ${untrustedTokens.length} tokens sent to org (${NEW_ROUTER_ADDRESS}):`, untrustedTokens);

            const txRequest = this.baseGroupMintRouter!.enableCRCForRouting(untrustedTokens);
            const tx = await this.runner!.sendTransaction({
              to: txRequest.to,
              data: txRequest.data,
            });
            console.log(`Trust enabling transaction sent, tx: ${tx.transactionHash}`);

            // Wait for transaction to be mined
            await publicClient.waitForTransactionReceipt({
              hash: tx.transactionHash as Hex,
              confirmations: 1,
            });
            console.log(`Trust enabled for ${untrustedTokens.length} tokens, tx confirmed: ${tx.transactionHash}`);
          } else {
            console.log('All tokens are already trusted, skipping transaction');
          }
        }
      }
      // @todo only temporary solution - replace old org address with new router address in transfers
      const pathTransfersWithReplacedOrg = buildPath.transfers.map((transfer: any) => {
        if (transfer.to?.toLowerCase() === ORG_ADDRESS) {
          return { ...transfer, to: NEW_ROUTER_ADDRESS };
        } else if (transfer.from?.toLowerCase() === ORG_ADDRESS) {
          return { ...transfer, from: NEW_ROUTER_ADDRESS };
        }
        return transfer;
      });

      const theFlow = createFlowMatrix(
        arbbotV2Address,
        toAddress,
        BigInt(buildPath.maxFlow),
        pathTransfersWithReplacedOrg
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

  async executeWithV2(
    buyNode: CirclesNode,
    sellNode: CirclesNode,
    requiredEth: bigint,
    crcAmount: bigint
  ) {
    if (!this.runner) {
      throw new Error("Runner not initialized");
    }

    const demurragedAmount = CirclesConverter.attoStaticCirclesToAttoCircles(crcAmount);
    const pathFlow = await this.getPathfinderTransferData(
      buyNode,
      sellNode,
      demurragedAmount,
    );

    if (!pathFlow || typeof pathFlow === 'bigint') {
      throw new Error("Failed to get pathfinder transfer data");
    }

    console.log("execution data");
    console.log(requiredEth, demurragedAmount);
    console.dir(pathFlow, {depth: null});

    // Convert Uint8Array to hex strings for viem compatibility
    const streams = pathFlow.streams.map((stream: any) => ({
      ...stream,
      data: stream.data instanceof Uint8Array ? bytesToHex(stream.data) : stream.data
    }));

    const txRequest = this.arbbotV2!.executeArbitrageWithFlashLoan(
      buyNode.erc20tokenAddress,
      buyNode.pools?.[0]!,
      sellNode.erc20tokenAddress,
      sellNode.pools?.[0]!,
      demurragedAmount,
      requiredEth * BigInt(101) / BigInt(100),
      {
        flowVertices: pathFlow.flowVertices as Address[],
        flow: pathFlow.flowEdges,
        streams: streams,
        packedCoordinates: pathFlow.packedCoordinates as Hex,
      },
      "0x0Bb4C6414e0d566d0F5cbEa10Ca695Dd9A3FFb97" as Address
    );

    const tx = await this.runner.sendTransaction({
      to: txRequest.to,
      data: txRequest.data,
    });

    console.log(tx?.transactionHash);
    return true;
  }

  /**
   * Get all pools on Gnosis chain in batches
   */
  public async getAllGnosisPools(): Promise<BalancerPool[]> {
    const BATCH_SIZE = 1000;
    const allPools: BalancerPool[] = [];

    try {
      const totalCount = await this.getGnosisPoolsCount();
      console.log(`Total pools to fetch: ${totalCount}`);

      const totalBatches = Math.ceil(totalCount / BATCH_SIZE);
      console.log(`Fetching pools in ${totalBatches} batches of ${BATCH_SIZE}`);

      for (let batch = 0; batch < totalBatches; batch++) {
        const skip = batch * BATCH_SIZE;
        console.log(`Fetching batch ${batch + 1}/${totalBatches} (skip: ${skip}, first: ${BATCH_SIZE})`);

        const batchPools = await this.getGnosisPoolsBatch(BATCH_SIZE, skip);
        allPools.push(...batchPools);

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

  private async getGnosisPoolsCount(): Promise<number> {
    try {
      const response = await fetch(BALANCER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: getGnosisPoolsCountQuery })
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

  private async getGnosisPoolsBatch(first: number, skip: number): Promise<BalancerPool[]> {
    try {
      const response = await fetch(BALANCER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: getGnosisPoolsBatchQuery,
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
