import { Address } from "../interfaces/index.js";

// Constant addresses
const erc20LiftAddress = "0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5";
const middlewareAddress = "0x36fad3df6d61060f285061f74d26eab2b514addb";

const PROFIT_THRESHOLD = BigInt(1e12); // profit threshold, should be denominated in the colalteral curreny

const DemurragedVSInflation = 1;

// global variables
const LOG_ACTIVITY = true;
// @todo make this amount adjustable
const QUERY_REFERENCE_AMOUNT = BigInt(1e17);
const EXPLORATION_RATE = 0.1;
const MIN_BUYING_AMOUNT = QUERY_REFERENCE_AMOUNT;
const RESYNC_INTERVAL = 1000 * 60 * 60; // Resync every 60 minutes
const DEFAULT_PRICE_REF_ADDRESS =
  "0x86533d1aDA8Ffbe7b6F7244F9A1b707f7f3e239b".toLowerCase() as Address; // METRI TEST SUPERGROUP
const TRADING_TOKEN =
  "0x6c76971f98945ae98dd7d4dfca8711ebea946ea6".toLowerCase() as Address; // wstETH
const QUOTE_TOKEN =
  "0xe91d153e0b41518a2ce8dd3d7944fa863463a97d".toLowerCase() as Address; // xDAI
const BALANCER_VAULT =
  "0xBA12222222228d8Ba445958a75a0704d566BF2C8".toLowerCase() as Address; // Balancer Vault V2
const QUOTE_TOKEN_DEMICALS = 18;
const TRADING_TOKEN_DECIMALS = 18;
const NODE_LIMIT = undefined;


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
    middlewareAddress,
    BALANCER_VAULT,
    DEFAULT_PRICE_REF_ADDRESS,
    EXPLORATION_RATE,
    LOG_ACTIVITY,
    MIN_BUYING_AMOUNT,
    NODE_LIMIT,
    PROFIT_THRESHOLD,
    QUERY_REFERENCE_AMOUNT,
    QUOTE_TOKEN,
    QUOTE_TOKEN_DEMICALS,
    RESYNC_INTERVAL,
    TRADING_TOKEN,
    TRADING_TOKEN_DECIMALS,
    logQuoteInsertQuery,
    logTradeInsertQuery,
    logLiquidityEstimateQuery
}