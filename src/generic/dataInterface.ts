import pg from "pg";

// Import viem
import { createPublicClient, http, type Hex, bytesToHex, encodeAbiParameters, parseAbiParameters } from "viem";
import { gnosis } from "viem/chains";

import {
  getV2PathToSDAI,
  getV3PathToSDAI,
} from './helpers/poolConfig.js';

// Import Balancer SDK
import {
  Token,
} from "@balancer/sdk";

// Import new Circles SDK
import { circlesConfig, Core } from '@aboutcircles/sdk-core';
import { CirclesConverter } from '@aboutcircles/sdk-utils';
import { CirclesRpc } from '@aboutcircles/sdk-rpc';
import { createFlowMatrix } from '@aboutcircles/sdk-pathfinder';
import type { Address } from '@aboutcircles/sdk-types';
import { PrivateKeyContractRunner } from './helpers/runner.js';


import {
  BalanceRow,
  BaseGroupRow,
  CirclesNode,
  TrustRelationRow,
  DataInterfaceParams,
  BalancerPool,
  PoolInfo
} from "./interfaces/index.js";
// Import contract wrappers
import {
  ArbbotOracleContract,
  ArbbotV2Contract,
  ERC20Contract,
  ERC20LiftContract,
  BaseGroupMintRouterContract,
} from './helpers/contracts.js';

import { wstETH } from './helpers/poolConfig.js';
 
import {
  DemurragedVSInflation,
  erc20LiftAddress,
  arbbotOracleAddress,
  arbbotV2Address,
  baseGroupMintRouterAddress,
  BALANCER_VAULT_V2,
  BALANCER_VAULT_V3,
  supportedTokens,
  BALANCER_API_URL,
  getNextSnapshotIdQuery,
  logPriceSnapshotQuery,
  logLiquidityObservationQuery,
  getBalancesQuery,
  getTrustRelationsQuery,
  getCurrentBackersQuery,
  fetchLatestLiquidityEstimatesQuery,
  getGnosisPoolsCountQuery,
  getGnosisPoolsBatchQuery
} from "./helpers/constants.js";

// Global config
const rpcUrl = process.env.RPC_URL!;
const chainId = 100;
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
  public logActivity: boolean;
  public runner?: PrivateKeyContractRunner;
  public core?: Core;
  public rpc?: CirclesRpc;
  public arbbotOracle?: ArbbotOracleContract;
  public arbbotV2?: ArbbotV2Contract;
  public liftERC20?: ERC20LiftContract;
  public baseGroupMintRouter?: BaseGroupMintRouterContract;

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
      const allGroups = await this.rpc?.group.findGroups(200);
      if(!allGroups) return [] as BaseGroupRow[];
      return allGroups
        .filter((row) => row.erc20WrapperStatic && row.erc20WrapperStatic !== '0x0')
        .map((row): BaseGroupRow => ({
          address: row.group,
          erc20tokenAddress: row.erc20WrapperStatic || '0x0'
        }));
    } catch (error) {
      console.error("Error fetching base groups:", error);
      return [];
    }
  }
  // Update nodes with Balancer V2 and V3 pool ids
  // @todo review how optimal is it
  private updateNodesWithPoolIds(nodes: CirclesNode[], pools: BalancerPool[]): CirclesNode[] {
    if (!nodes || !Array.isArray(nodes)) {
      console.warn('Invalid nodes array provided');
      return [];
    }

    if (!pools || !Array.isArray(pools)) {
      console.warn('Invalid pools array provided');
      return nodes;
    }

    console.log(`Updating ${nodes.length} nodes with pool IDs from ${pools.length} available pools (V2 and V3)`);

    const supportedTokensLower = supportedTokens.map(token => token.toLowerCase());
    const tokenToPoolInfoMap = new Map<string, PoolInfo[]>();

    pools.forEach(pool => {
      if (pool.poolTokens && Array.isArray(pool.poolTokens)) {
        // Skip multi-token pools (more than 2 tokens)
        if (pool.poolTokens.length > 2) {
          return;
        }

        // Check if pool contains at least one supported token
        const hasSupprotedToken = pool.poolTokens.some((token: any) =>
          supportedTokensLower.includes(token.address.toLowerCase())
        );

        if (!hasSupprotedToken) {
          return;
        }

        const isV3 = pool.protocolVersion === 3;

        // For each token in the pool, create a PoolInfo entry
        pool.poolTokens.forEach((token: any) => {
          const tokenAddress = token.address.toLowerCase();

          // Find the other token (intermediate token)
          const otherToken = pool.poolTokens.find((t: any) =>
            t.address.toLowerCase() !== tokenAddress
          );
          // @todo update
          const poolInfo: PoolInfo = {
            poolId: isV3 ? pool.address : pool.id, // V3 uses address, V2 uses id
            isV3: isV3,
            intermediateToken: otherToken?.address.toLowerCase() as Address || '0x0000000000000000000000000000000000000000'
          };

          if (!tokenToPoolInfoMap.has(tokenAddress)) {
            tokenToPoolInfoMap.set(tokenAddress, []);
          }

          tokenToPoolInfoMap.get(tokenAddress)!.push(poolInfo);
        });
      }
    });

    console.log(`Created token-to-pool mapping for ${tokenToPoolInfoMap.size} unique tokens`);

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
      const matchingPools = tokenToPoolInfoMap.get(tokenAddress) || [];

      const v2Count = matchingPools.filter(p => !p.isV3).length;
      const v3Count = matchingPools.filter(p => p.isV3).length;
      console.log(`Token ${node.erc20tokenAddress} found in ${matchingPools.length} pools (V2: ${v2Count}, V3: ${v3Count})`);

      return {
        ...node,
        pools: matchingPools
      };
    });

    const totalPoolsAssigned = updatedNodes.reduce((sum, node) => sum + (node.pools?.length || 0), 0);
    const nodesWithPools = updatedNodes.filter(node => (node.pools?.length || 0) > 0).length;

    console.log(`Summary: ${nodesWithPools}/${updatedNodes.length} nodes have pools assigned`);
    console.log(`Total pool assignments: ${totalPoolsAssigned}`);

    return updatedNodes;
  }

  public async loadNodes(limit?: number): Promise<CirclesNode[]> {
    const nodes: CirclesNode[] = [];
    if(process.env.ONLY_GROUPS !== "true") {
      const backerAddresses = await this.getCurrentBackers();
      for (const backerAddress of backerAddresses) {
        // @todo possible we might enrich this with the avatars data
        const tokenAddress = await this.getERC20Token(backerAddress);

        // Skip if we couldn't get a valid token address
        if (!tokenAddress) {
          console.warn(`Skipping backer ${backerAddress} - no valid ERC20 token`);
          continue;
        }

        const node: CirclesNode = {
          avatar: backerAddress as Address,
          isGroup: false,
          pools: [],
          erc20tokenAddress: tokenAddress as Address,
          lastUpdated: Date.now(),
        };
        nodes.push(node);
      }
    }

    const baseGroups = await this.getBaseGroups();
    for (const group of baseGroups) {
      const balancerVaultV2Balance = await this.getERC20Balance(group.erc20tokenAddress as Address, BALANCER_VAULT_V2);
      const balancerVaultV3Balance = await this.getERC20Balance(group.erc20tokenAddress as Address, BALANCER_VAULT_V3);
      // Skip groups with no balance in either vault, this means their tokens are not traded on Balancer
      if (!balancerVaultV2Balance && !balancerVaultV3Balance) {
        continue;
      }

      const node: CirclesNode = {
        avatar: group.address,
        isGroup: true,
        pools: [],
        erc20tokenAddress: group.erc20tokenAddress as Address,
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

  public async getERC20Token(avatarAddress: string): Promise<string | null> {
    try {
      const tokenAddress = await this.liftERC20!.erc20Circles(
        DemurragedVSInflation,
        avatarAddress as Address,
      );

      if (tokenAddress === '0x0000000000000000000000000000000000000000') {
        return null;
      }
      return tokenAddress.toLowerCase();
    } catch (error) {
      console.warn(`Failed to get ERC20 token for avatar ${avatarAddress}:`, error instanceof Error ? error.message : error);
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

  /**
   * Calculate arbitrage profitability using the new oracle
   * @param token1 Buy token (CRC to buy)
   * @param pool1Info Pool info for buying
   * @param token2 Sell token (CRC to sell)
   * @param pool2Info Pool info for selling
   * @param amount Amount of CRC to trade
   * @returns [isProfitable, profitInWstETH, wstETHNeeded]
   */
  public async getTradeCalculation(
    token1: Address,
    pool1Info: PoolInfo,
    token2: Address,
    pool2Info: PoolInfo,
    amount: bigint
  ): Promise<readonly [boolean, bigint, bigint]> {

    try {
      let wstETHNeeded: bigint;
      let wstETHReceived: bigint;

      // Build forward steps: wstETH -> token1 (buy)
      if (pool1Info.isV3) {
        const forwardStepsV3 = await this.arbbotOracle!.buildForwardSwapStepsV3(
          token1,
          pool1Info.poolId as Address
        );
        wstETHNeeded = await this.arbbotOracle!.getAmountInV3(
          wstETH,
          amount,
          forwardStepsV3
        );
      } else {
        const stepsForwardV2 = await this.arbbotOracle!.buildForwardSwapStepsV2(
          token1,
          pool1Info.poolId
        );
        wstETHNeeded = await this.arbbotOracle!.getAmountInV2(wstETH, amount, stepsForwardV2);
      }

      // Build backward steps: token2 -> wstETH (sell)
      if (pool2Info.isV3) {
        const backwardStepsV3 = await this.arbbotOracle!.buildBackwardSwapStepsV3(
          token2,
          pool2Info.poolId as Address
        );

        wstETHReceived = await this.arbbotOracle!.getAmountOutV3(
          token2,
          amount,
          backwardStepsV3
        );
      } else {
        const backwardStepsV2 = await this.arbbotOracle!.buildBackwardSwapStepsV2(
          token2,
          pool2Info.poolId
        );
        wstETHReceived = await this.arbbotOracle!.getAmountOutV2(
          token2,
          amount,
          backwardStepsV2
        );
      } 

      // Calculate profit
      if(wstETHReceived === 0n || wstETHNeeded === 0n) {
        throw new Error("Error: Unable to get the trade calculations from the oracle");
      }
    
      const isProfitable = wstETHReceived > wstETHNeeded;
      const profitInWstETH = isProfitable ? wstETHReceived - wstETHNeeded : 0n;

      return [isProfitable, profitInWstETH, wstETHNeeded] as const;
    } catch (error) {
      return [false, 0n, 0n ] as const;
    }
  }

  /**
   * Get oracle spot price for a CRC token in sDAI terms
   * Uses pre-defined paths matching BalancerOracle.sol's internal paths
   * Optimized to make only one call per getAmountOut function
   * @param tokenAddress CRC ERC20 token address
   * @param poolInfo Pool information (id, version, and intermediate token)
   * @returns Price in sDAI (amount of sDAI per 1e18 CRC)
   */
  public async getOracleSpotPrice(tokenAddress: Address, poolInfo: PoolInfo): Promise<bigint> {
    // 0x5b10e15404c490892ebb6a2c7a22bb594c32e9e8 0xa2ce3ddfb4ca620d3c9a14fd30aac3851cd47ef5
    try {
      const referenceAmount = BigInt(1e18); // 1 token

      // Get intermediate token from poolInfo
      if (!poolInfo.intermediateToken) {
        throw new Error("No info about the intermediate tokens");
      }
      const intermediateToken = poolInfo.intermediateToken;

      let sdaiAmount: bigint;

      if (poolInfo.isV3) {
        // V3 flow: CRC -> intermediate (via V3 pool) -> sDAI (via V3 multi-hop path)
        const v3PathToSDAI = getV3PathToSDAI(intermediateToken);

        if (v3PathToSDAI === null) {
          console.warn(`No V3 path found from ${intermediateToken} to sDAI`);
          return 0n;
        }

        // Build combined V3 path: CRC -> intermediate -> ... -> sDAI
        // This combines the CRC->intermediate hop with the static path to sDAI
        const combinedV3Path = [
          {
            pool: poolInfo.poolId as Address,
            tokenOut: intermediateToken,
            isBuffer: false
          },
          ...v3PathToSDAI  // Empty array if intermediate is already sDAI
        ];
        // Convert intermediate to sDAI via V3
        // Note: V3 queries must be called with from=0x0 (similar to vm.prank in Solidity tests)
        sdaiAmount = await this.arbbotOracle!.getAmountOutV3(
          tokenAddress,
          referenceAmount,
          combinedV3Path
        ) as bigint;
      } else {
        // V2 flow: CRC -> intermediate -> ... -> sDAI
        const v2PathToSDAI = getV2PathToSDAI(intermediateToken);

        if (v2PathToSDAI === null) {
          console.warn(`No V2 path found from ${intermediateToken} to sDAI`);
          return 0n;
        }

        // Build combined V2 path: CRC -> intermediate -> ... -> sDAI
        // This combines the CRC->intermediate hop with the constant path to sDAI
        const combinedV2Path = [
          {
            poolId: poolInfo.poolId,
            tokenOut: intermediateToken
          },
          ...v2PathToSDAI  // Empty array if intermediate is already sDAI
        ];

        // Single V2 call for entire path from CRC to sDAI
        sdaiAmount = await this.arbbotOracle!.getAmountOutV2(
          tokenAddress,
          referenceAmount,
          combinedV2Path
        );
      }

      return sdaiAmount;
    } catch (error) {
      console.error(`Error fetching oracle price for ${tokenAddress} ${poolInfo.poolId} (V${poolInfo.isV3 ? '3' : '2'}):`, error);
      return 0n;
    }
  }

  public async getPathfinderTransferData(
    from: CirclesNode,
    to: CirclesNode,
    amount: bigint,
    onlyMaxFlow: boolean = false
  ) {
    try {
      const toAddress = arbbotV2Address;
      const toTokens = [to.avatar];

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
      const simulatedTrusts = [
        {
          truster: arbbotV2Address as Address,
          trustee: to.avatar
        }
      ];

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
        maxTransfers: 70,
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

  /**
   * Execute arbitrage using new ArbbotV2 contract (with SwapConfig)
   */
  async executeArbitrageV2(
    buyNode: CirclesNode,
    sellNode: CirclesNode,
    flashLoanAmount: bigint,
    crcAmount: bigint,
    // @todo this address should be picked from const
    collector: Address = "0x0Bb4C6414e0d566d0F5cbEa10Ca695Dd9A3FFb97" as Address
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

    console.log("Execution data");
    console.log("Flash loan amount:", flashLoanAmount);
    console.log("CRC amount (demurraged):", demurragedAmount);
    console.dir(pathFlow, {depth: null});

    // Convert Uint8Array to hex strings for viem compatibility
    const streams = pathFlow.streams.map((stream: any) => ({
      ...stream,
      data: stream.data instanceof Uint8Array ? bytesToHex(stream.data) : stream.data
    }));

    const wstETH = "0x6C76971f98945AE98dD7d4DFcA8711ebea946eA6" as Address;

    // Build forward swap configs (wstETH -> sourceCRC)
    const buyPool = buyNode.pools?.[0];
    if (!buyPool) throw new Error("Buy node has no pools");

    let forwardSwaps: { isV3: boolean; swapData: Hex }[];

    if (buyPool.isV3) {
      // Get V3 steps
      const forwardSteps = await this.arbbotV2!.read('buildForwardSwapStepsV3', [
        buyNode.erc20tokenAddress,
        buyPool.poolId as Address
      ]) as readonly [Address, Address, boolean][];

      // Manually encode SwapPathExactAmountIn
      const swapData = encodeAbiParameters(
        parseAbiParameters('(address tokenIn, (address pool, address tokenOut, bool isBuffer)[] steps, uint256 exactAmountIn, uint256 minAmountOut)'),
        [{
          tokenIn: wstETH,
          steps: forwardSteps.map((step: any) => ({
            pool: step[0] || step.pool,
            tokenOut: step[1] || step.tokenOut,
            isBuffer: step[2] ?? step.isBuffer
          })),
          exactAmountIn: demurragedAmount,
          minAmountOut: 0n
        }]
      );

      forwardSwaps = [{ isV3: true, swapData }];
    } else {
      // Get V2 steps
      const forwardSteps = await this.arbbotV2!.read('buildForwardSwapStepsV2', [
        buyNode.erc20tokenAddress,
        buyPool.poolId
      ]) as readonly [string, Address][];

      // Build assets array: [wstETH, ...intermediates, finalCRC]
      const assets: Address[] = [wstETH];
      for (const step of forwardSteps) {
        const tokenOut = step[1] || (step as any).tokenOut;
        assets.push(tokenOut);
      }

      // Build batch swap steps
      const batchSteps = forwardSteps.map((step, i) => {
        const poolId = step[0] || (step as any).poolId;
        return {
          poolId: poolId,
          assetInIndex: BigInt(i),
          assetOutIndex: BigInt(i + 1),
          amount: i === 0 ? demurragedAmount : 0n,
          userData: '0x' as Hex
        };
      });

      // Build limits: [input, ...zeros, -1]
      const limits: bigint[] = [demurragedAmount];
      for (let i = 1; i < assets.length - 1; i++) {
        limits.push(0n);
      }
      limits.push(-1n);

      // Manually encode (BatchSwapStep[], address[], int256[])
      const swapData = encodeAbiParameters(
        parseAbiParameters('(bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[], address[], int256[]'),
        [batchSteps, assets, limits]
      );

      forwardSwaps = [{ isV3: false, swapData }];
    }

    // Build backward swap configs (targetCRC -> wstETH)
    const sellPool = sellNode.pools?.[0];
    if (!sellPool) throw new Error("Sell node has no pools");

    let backwardSwaps: { isV3: boolean; swapData: Hex }[];

    if (sellPool.isV3) {
      // Get V3 steps
      const backwardSteps = await this.arbbotV2!.read('buildBackwardSwapStepsV3', [
        sellNode.erc20tokenAddress,
        sellPool.poolId as Address
      ]) as readonly [Address, Address, boolean][];

      // Manually encode SwapPathExactAmountIn
      const swapData = encodeAbiParameters(
        parseAbiParameters('(address tokenIn, (address pool, address tokenOut, bool isBuffer)[] steps, uint256 exactAmountIn, uint256 minAmountOut)'),
        [{
          tokenIn: sellNode.erc20tokenAddress,
          steps: backwardSteps.map((step: any) => ({
            pool: step[0] || step.pool,
            tokenOut: step[1] || step.tokenOut,
            isBuffer: step[2] ?? step.isBuffer
          })),
          exactAmountIn: demurragedAmount,
          minAmountOut: 0n
        }]
      );

      backwardSwaps = [{ isV3: true, swapData }];
    } else {
      // Get V2 steps
      const backwardSteps = await this.arbbotV2!.read('buildBackwardSwapStepsV2', [
        sellNode.erc20tokenAddress,
        sellPool.poolId
      ]) as readonly [string, Address][];

      // Build assets array: [sourceCRC, ...intermediates, wstETH]
      const assets: Address[] = [sellNode.erc20tokenAddress];
      for (const step of backwardSteps) {
        const tokenOut = step[1] || (step as any).tokenOut;
        assets.push(tokenOut);
      }

      // Build batch swap steps
      const batchSteps = backwardSteps.map((step, i) => {
        const poolId = step[0] || (step as any).poolId;
        return {
          poolId: poolId,
          assetInIndex: BigInt(i),
          assetOutIndex: BigInt(i + 1),
          amount: i === 0 ? demurragedAmount : 0n,
          userData: '0x' as Hex
        };
      });

      // Build limits: [input, ...zeros, -1]
      const limits: bigint[] = [demurragedAmount];
      for (let i = 1; i < assets.length - 1; i++) {
        limits.push(0n);
      }
      limits.push(-1n);

      // Manually encode (BatchSwapStep[], address[], int256[])
      const swapData = encodeAbiParameters(
        parseAbiParameters('(bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[], address[], int256[]'),
        [batchSteps, assets, limits]
      );

      backwardSwaps = [{ isV3: false, swapData }];
    }

    const txRequest = this.arbbotV2!.executeArbitrage({
      flashLoanToken: wstETH,
      flashLoanAmount: flashLoanAmount * BigInt(101) / BigInt(100), // Add 1% buffer
      unwrapFlashloanToken: false,
      flashloanUnderlyingToken: "0x0000000000000000000000000000000000000000" as Address,
      forwardSwaps: forwardSwaps,
      sourceCRC: buyNode.erc20tokenAddress,
      targetCRC: sellNode.erc20tokenAddress,
      transitiveePath: {
        flowVertices: pathFlow.flowVertices as Address[],
        flow: pathFlow.flowEdges,
        streams: streams,
        packedCoordinates: pathFlow.packedCoordinates as Hex,
      },
      backwardSwaps: backwardSwaps,
      wrapBackToFlashloan: false,
      backwardOutputToken: wstETH,
      collector: collector,
    });

    const tx = await this.runner.sendTransaction({
      to: txRequest.to,
      data: txRequest.data,
    });

    console.log("Transaction hash:", tx?.transactionHash);
    return true;
  }

  // @todo optimize the graphql calls
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
