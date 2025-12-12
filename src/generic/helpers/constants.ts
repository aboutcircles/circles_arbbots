import { Address } from "../interfaces/index.js";

// Constant addresses
const erc20LiftAddress = "0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5";
const arbbotOracleAddress = "0xc706389fc1cfebf04e9c26bc004d746020fc91e7"; // New BalancerOracle with V2/V3 support
const arbbotV2Address = "0xa28c43F92F6498AFAE4266B29a668624bA031913";
const baseGroupMintRouterAddress = "0xDC287474114cC0551a81DdC2EB51783fBF34802F";
const PROFIT_THRESHOLD = BigInt(1e12); // profit threshold, should be denominated in the collateral currency

const DemurragedVSInflation = 1;

// global variables
const LOG_ACTIVITY = false;
// @todo make this amount adjustable
const QUERY_REFERENCE_AMOUNT = BigInt(5e17);
const RESYNC_INTERVAL = 1000 * 60 * 60; // Resync every 60 minutes
const BALANCER_VAULT_V2 =
  "0xBA12222222228d8Ba445958a75a0704d566BF2C8".toLowerCase() as Address; // Balancer Vault V2
const BALANCER_VAULT_V3 =
  "0xbA1333333333a1BA1108E8412f11850A5C319bA9".toLowerCase() as Address; // Balancer Vault V3
const NODE_LIMIT = 1000; // Increased from 5 to allow more nodes
const BALANCER_API_URL = "https://api-v3.balancer.fi/";
const MAX_ARBITRAGE_CRC_AMOUNT = BigInt(1e21);

// @todo update the list of supported tokens for v2 and v3 accordingly
// Supported pair tokens in the pools with circles tokens
const supportedTokens: Address[] = [
  "0xaf204776c7245bF4147c2612BF6e5972Ee483701", // sDAI
  "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1", // WETH
  "0x6C76971f98945AE98dD7d4DFcA8711ebea946eA6", // wstETH
  "0x8e5bBbb09Ed1ebdE8674Cda39A0c169401db4252", // WBTC
  "0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb" // GNO
];

// Database queries
const getNextSnapshotIdQuery = `
  SELECT COALESCE(MAX(snapshot_id), 0) + 1 as next_id
  FROM price_snapshot
`;

const logPriceSnapshotQuery = `
  INSERT INTO price_snapshot (
    snapshot_id,
    token,
    pool_id,
    pool_type,
    price,
    ref_token,
    swap_amount,
    timestamp
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8))
`;

const logLiquidityObservationQuery = `
  INSERT INTO liquidity_observations (
    timestamp,
    source_avatar,
    target_avatar,
    measured_liquidity,
    required_amount,
    edge_id,
    edge_score,
    success,
    source_token_price,
    target_token_price,
    ref_token
  ) VALUES (
    to_timestamp($1), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
  )
`;

const getBalancesQuery = `
  SELECT
    account,
    "demurragedTotalBalance"::numeric as "demurragedTotalBalance",
    "tokenAddress"
  FROM "V_CrcV2_BalancesByAccountAndToken"
  WHERE "tokenAddress" = ANY($1)
`;

const getTrustRelationsQuery = `
  SELECT "truster", "trustee"
  FROM "V_CrcV2_TrustRelations"
`;

const getCurrentBackersQuery = `
  SELECT
    "backer"
  FROM "CrcV2_CirclesBackingCompleted"
`;

const fetchLatestLiquidityEstimatesQuery = `
  WITH LatestObservations AS (
    SELECT
      source_avatar,
      target_avatar,
      measured_liquidity,
      timestamp,
      ROW_NUMBER() OVER (
        PARTITION BY source_avatar, target_avatar
        ORDER BY timestamp DESC
      ) as rn
    FROM liquidity_observations
  )
  SELECT
    source_avatar,
    target_avatar,
    measured_liquidity,
    EXTRACT(EPOCH FROM timestamp) as timestamp
  FROM LatestObservations
  WHERE rn = 1
`;

const getGnosisPoolsCountQuery = `
  query GetGnosisPoolsCount {
    poolGetPoolsCount(
      where: {
        chainIn: [GNOSIS]
        protocolVersionIn: [2, 3]
      }
    )
  }
`;

const getGnosisPoolsBatchQuery = `
  query GetGnosisPools($first: Int!, $skip: Int!) {
    poolGetPools(
      where: {
        chainIn: [GNOSIS]
        protocolVersionIn: [2, 3]
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
      protocolVersion
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

const logLiquidityEstimateQuery = `
  INSERT INTO "liquidity_estimates" (
    "timestamp",
    "source_avatar",
    "target_avatar",
    "source_token",
    "target_token",
    "liquidity",
    "source_price",
    "target_price"
  )
  VALUES (to_timestamp($1), $2, $3, $4, $5, $6, $7, $8)
`;

export {
    DemurragedVSInflation,
    erc20LiftAddress,
    arbbotOracleAddress,
    arbbotV2Address,
    baseGroupMintRouterAddress,
    BALANCER_VAULT_V2,
    BALANCER_VAULT_V3,
    LOG_ACTIVITY,
    NODE_LIMIT,
    PROFIT_THRESHOLD,
    MAX_ARBITRAGE_CRC_AMOUNT,
    QUERY_REFERENCE_AMOUNT,
    RESYNC_INTERVAL,
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
    getGnosisPoolsBatchQuery,
    logLiquidityEstimateQuery
}