import { Address } from "../interfaces/index.js";

// Constant addresses
const erc20LiftAddress = "0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5";
const arbbotOracleAddress = "0xd16Fd7cAfB58EFd5df2a34d6BD96B0e9703efF49";
const arbbotV2Address = "0x767eB36A98a89EB7DE6AD4d0A1049584cB54885e";
const PROFIT_THRESHOLD = BigInt(1e12); // profit threshold, should be denominated in the collateral currency

const DemurragedVSInflation = 1;

// global variables
const LOG_ACTIVITY = false;
// @todo make this amount adjustable
const QUERY_REFERENCE_AMOUNT = BigInt(1e18);
const EXPLORATION_RATE = 0.1;
const MIN_BUYING_AMOUNT = QUERY_REFERENCE_AMOUNT;
const RESYNC_INTERVAL = 1000 * 60 * 60; // Resync every 60 minutes
const DEFAULT_PRICE_REF_ADDRESS =
  "0x86533d1aDA8Ffbe7b6F7244F9A1b707f7f3e239b".toLowerCase() as Address; // METRI TEST SUPERGROUP
const QUOTE_TOKEN =
  "0xe91d153e0b41518a2ce8dd3d7944fa863463a97d".toLowerCase() as Address; // xDAI
const BALANCER_VAULT =
  "0xBA12222222228d8Ba445958a75a0704d566BF2C8".toLowerCase() as Address; // Balancer Vault V2
const QUOTE_TOKEN_DEMICALS = 18;
const NODE_LIMIT = 5;
const BALANCER_API_URL = "https://api-v3.balancer.fi/";
const MAX_ARBITRAGE_CRC_AMOUNT = BigInt(1e21);

// Supported pair tokens in the pools with circles tokens
const supportedTokens: Address[] = [
  "0xaf204776c7245bF4147c2612BF6e5972Ee483701", // sDAI
  "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1", // WETH
  "0x6C76971f98945AE98dD7d4DFcA8711ebea946eA6", // wstETH
  "0x8e5bBbb09Ed1ebdE8674Cda39A0c169401db4252", // WBTC
  "0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb" // GNO
];

const logQuoteInsertQuery = `INSERT INTO "quotes" ("timestamp", "inputtoken", "outputtoken", "inputamountraw", "outputamountraw") VALUES (to_timestamp($1), $2, $3, $4, $5)`;

const logTradeInsertQuery = `INSERT INTO "tradeOpportunties" ("timestamp", "buytoken", "selltoken", "referencetoken", "buyamount", "intermediateamount", "sellamount", "estimatedprofit") VALUES (to_timestamp($1), $2, $3, $4, $5, $6, $7, $8)`;

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
    BALANCER_VAULT,
    DEFAULT_PRICE_REF_ADDRESS,
    EXPLORATION_RATE,
    LOG_ACTIVITY,
    MIN_BUYING_AMOUNT,
    NODE_LIMIT,
    PROFIT_THRESHOLD,
    MAX_ARBITRAGE_CRC_AMOUNT,
    QUERY_REFERENCE_AMOUNT,
    QUOTE_TOKEN,
    QUOTE_TOKEN_DEMICALS,
    RESYNC_INTERVAL,
    supportedTokens,
    logQuoteInsertQuery,
    logTradeInsertQuery,
    logLiquidityEstimateQuery,
    BALANCER_API_URL
}