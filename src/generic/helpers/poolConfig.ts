import { Address } from "../interfaces/index.js";

/**
 * Pool and Token Configuration for Circles Arbbot V2
 *
 * This file contains all the pool addresses and token addresses needed for
 * constructing swap paths through Balancer V2 and V3.
 */

// ============ Standard Tokens ============

export const WETH: Address = "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1" as Address;
export const wstETH: Address = "0x6C76971f98945AE98dD7d4DFcA8711ebea946eA6" as Address;
export const WBTC: Address = "0x8e5bBbb09Ed1ebdE8674Cda39A0c169401db4252" as Address;
export const GNO: Address = "0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb" as Address;
export const sDAI: Address = "0xaf204776c7245bF4147c2612BF6e5972Ee483701" as Address;

// ============ Wrapped Aave Tokens (ERC4626) ============

export const WAGNO_GNO: Address = "0x7c16F0185A26Db0AE7a9377f23BC18ea7ce5d644" as Address;
export const WAGNO_WSTETH: Address = "0x773CDA0CADe2A3d86E6D4e30699d40bB95174ff2" as Address;
export const WAGNO_WETH: Address = "0x57f664882F762FA37903FC864e2B633D384B411A" as Address;

// ============ Balancer V2 Pools (bytes32 pool IDs) ============

export const WETH_wstETH_POOL = "0xbad20c15a773bf03ab973302f61fabcea5101f0a000000000000000000000034";
export const wstETH_sDAI_POOL = "0xbc2acf5e821c5c9f8667a36bb1131dad26ed64f9000200000000000000000063";
export const wstETH_GNO_POOL = "0x4683e340a8049261057d5ab1b29c8d840e75695e00020000000000000000005a";
export const WBTC_wstETH_POOL = "0x717633a41211c944c7808013b44824c3d9bb63cd000200000000000000000116";

// ============ Balancer V3 Pools (addresses) ============

export const V3_sDAI_waGnoGNO_POOL: Address = "0xd1d7fa8871d84d0e77020fc28b7cd5718c446522" as Address;
export const V3_waGnoGNO_waGnowstETH_POOL: Address = "0x272d6be442e30d7c87390edeb9b96f1e84cecd8d" as Address;
export const V3_waGnoWETH_waGnowstETH_POOL: Address = "0x6e6bb18449fCF15B79EFa2CfA70ACF7593088029" as Address;
export const V3_MULTI_POOL: Address = "0x5A15b1e1AB9EC2946FBb27Cd3823297719C1332a" as Address; // Multi-token pool with wstETH, WBTC, GNO, sDAI

// ============ Example Pool Path Definitions ============

/**
 * Balancer V2 swap path: wstETH → WETH → s-CRC
 * Used for converting flashloaned wstETH to source Circles token
 */
export interface V2SwapPath {
  poolId: string;
  tokenIn: Address;
  tokenOut: Address;
}

/**
 * Balancer V3 swap path step
 * Used for multi-hop swaps through V3 pools
 */
export interface V3SwapPathStep {
  pool: Address;
  tokenOut: Address;
  isBuffer: boolean;
}

// ============================================================================
// Pre-defined Paths to sDAI (matching BalancerOracle.sol implementation)
// ============================================================================

/**
 * V2 Paths: Intermediate Token -> wstETH -> sDAI
 * These paths match the oracle's v2StableSwapPaths
 */

// WETH -> wstETH -> sDAI (V2, 2 hops)
export const V2_WETH_TO_SDAI: V2SwapPath[] = [
  {
    poolId: WETH_wstETH_POOL,
    tokenIn: WETH,
    tokenOut: wstETH,
  },
  {
    poolId: wstETH_sDAI_POOL,
    tokenIn: wstETH,
    tokenOut: sDAI,
  }
];

// GNO -> wstETH -> sDAI (V2, 2 hops)
export const V2_GNO_TO_SDAI: V2SwapPath[] = [
  {
    poolId: wstETH_GNO_POOL,
    tokenIn: GNO,
    tokenOut: wstETH,
  },
  {
    poolId: wstETH_sDAI_POOL,
    tokenIn: wstETH,
    tokenOut: sDAI,
  }
];

// WBTC -> wstETH -> sDAI (V2, 2 hops)
export const V2_WBTC_TO_SDAI: V2SwapPath[] = [
  {
    poolId: WBTC_wstETH_POOL,
    tokenIn: WBTC,
    tokenOut: wstETH,
  },
  {
    poolId: wstETH_sDAI_POOL,
    tokenIn: wstETH,
    tokenOut: sDAI,
  }
];

// wstETH -> sDAI (V2, 1 hop)
export const V2_WSTETH_TO_SDAI: V2SwapPath[] = [
  {
    poolId: wstETH_sDAI_POOL,
    tokenIn: wstETH,
    tokenOut: sDAI,
  }
];

/**
 * V3 Paths: Intermediate Token -> wstETH -> sDAI
 * These paths match the oracle's v3StableSwapPaths with buffer support
 */

// WETH -> waGnoWETH (buffer) -> waGnowstETH (pool) -> wstETH (buffer) -> sDAI (V2 pool)
export const V3_WETH_TO_SDAI: V3SwapPathStep[] = [
  {
    pool: WAGNO_WETH, // Buffer wrap
    tokenOut: WAGNO_WETH,
    isBuffer: true,
  },
  {
    pool: V3_waGnoWETH_waGnowstETH_POOL,
    tokenOut: WAGNO_WSTETH,
    isBuffer: false,
  },
  {
    pool: WAGNO_WSTETH, // Buffer unwrap
    tokenOut: wstETH,
    isBuffer: true,
  }
];

// WBTC -> wstETH (V3 multi-pool) -> sDAI (V2 pool)
export const V3_WBTC_TO_SDAI: V3SwapPathStep[] = [
  {
    pool: V3_MULTI_POOL,
    tokenOut: wstETH,
    isBuffer: false,
  }
];

// sDAI -> waGnoGNO (pool) -> waGnowstETH (pool) -> wstETH (buffer) -> sDAI
// Note: This is sDAI -> wstETH path (reverse for wstETH -> sDAI is just V2)
export const V3_SDAI_TO_WSTETH: V3SwapPathStep[] = [
  {
    pool: V3_sDAI_waGnoGNO_POOL,
    tokenOut: WAGNO_GNO,
    isBuffer: false,
  },
  {
    pool: V3_waGnoGNO_waGnowstETH_POOL,
    tokenOut: WAGNO_WSTETH,
    isBuffer: false,
  },
  {
    pool: WAGNO_WSTETH, // Buffer unwrap
    tokenOut: wstETH,
    isBuffer: true,
  }
];

/**
 * Get V2 path from intermediate token to wstETH
 * These paths match the oracle's v2StableSwapPaths (stored as token -> wstETH)
 * @param intermediateToken - The intermediate token address (WETH, GNO, WBTC, sDAI)
 * @returns V2SwapPath[] or null if no path exists
 */
export function getV2PathToWstETH(intermediateToken: Address): V2SwapPath[] | null {
  const tokenLower = intermediateToken.toLowerCase();

  // WETH -> wstETH (V2, 1 hop)
  if (tokenLower === WETH.toLowerCase()) {
    return [
      {
        poolId: WETH_wstETH_POOL,
        tokenIn: WETH,
        tokenOut: wstETH,
      }
    ];
  }

  // sDAI -> wstETH (V2, 1 hop)
  if (tokenLower === sDAI.toLowerCase()) {
    return [
      {
        poolId: wstETH_sDAI_POOL,
        tokenIn: sDAI,
        tokenOut: wstETH,
      }
    ];
  }

  // GNO -> wstETH (V2, 1 hop)
  if (tokenLower === GNO.toLowerCase()) {
    return [
      {
        poolId: wstETH_GNO_POOL,
        tokenIn: GNO,
        tokenOut: wstETH,
      }
    ];
  }

  // WBTC -> wstETH (V2, 1 hop)
  if (tokenLower === WBTC.toLowerCase()) {
    return [
      {
        poolId: WBTC_wstETH_POOL,
        tokenIn: WBTC,
        tokenOut: wstETH,
      }
    ];
  }

  // Already wstETH
  if (tokenLower === wstETH.toLowerCase()) {
    return [];
  }

  return null;
}

/**
 * Get V2 path from intermediate token to sDAI
 * @param intermediateToken - The intermediate token address (WETH, GNO, WBTC, wstETH)
 * @returns V2SwapPath[] or null if no path exists
 */
export function getV2PathToSDAI(intermediateToken: Address): V2SwapPath[] | null {
  const tokenLower = intermediateToken.toLowerCase();

  if (tokenLower === WETH.toLowerCase()) return V2_WETH_TO_SDAI;
  if (tokenLower === GNO.toLowerCase()) return V2_GNO_TO_SDAI;
  if (tokenLower === WBTC.toLowerCase()) return V2_WBTC_TO_SDAI;
  if (tokenLower === wstETH.toLowerCase()) return V2_WSTETH_TO_SDAI;
  if (tokenLower === sDAI.toLowerCase()) return []; // Already sDAI

  return null;
}

/**
 * Get V3 path from intermediate token to wstETH
 * These paths match the oracle's v3StableSwapPaths with buffer support
 * Based on the Solidity implementation in BalancerOracle.sol lines 636-682
 * @param intermediateToken - The intermediate token address (WETH, WBTC, sDAI)
 * @returns V3SwapPathStep[] or null if no path exists
 */
export function getV3PathToWstETH(intermediateToken: Address): V3SwapPathStep[] | null {
  const tokenLower = intermediateToken.toLowerCase();

  // WETH -> wstETH (V3, 3 hops with buffers)
  // Path: WETH -> waGnoWETH (buffer) -> waGnowstETH (pool) -> wstETH (buffer unwrap)
  if (tokenLower === WETH.toLowerCase()) {
    return [
      // Step 1: Wrap WETH -> waGnoWETH via V3 buffer
      {
        pool: WAGNO_WETH,              // 0x57f664882F762FA37903FC864e2B633D384B411A
        tokenOut: WAGNO_WETH,          // Same as pool for buffer wrap
        isBuffer: true
      },
      // Step 2: Swap waGnoWETH -> waGnowstETH in V3 pool
      {
        pool: V3_waGnoWETH_waGnowstETH_POOL,  // 0x6e6bb18449fCF15B79EFa2CfA70ACF7593088029
        tokenOut: WAGNO_WSTETH,                // 0x773CDA0CADe2A3d86E6D4e30699d40bB95174ff2
        isBuffer: false
      },
      // Step 3: Unwrap waGnowstETH -> wstETH via V3 buffer
      {
        pool: WAGNO_WSTETH,            // 0x773CDA0CADe2A3d86E6D4e30699d40bB95174ff2
        tokenOut: wstETH,              // 0x6C76971f98945AE98dD7d4DFcA8711ebea946eA6
        isBuffer: true
      }
    ];
  }

  // WBTC -> wstETH (V3, 1 hop in multi-token pool)
  if (tokenLower === WBTC.toLowerCase()) {
    return [
      {
        pool: V3_MULTI_POOL,           // 0x5A15b1e1AB9EC2946FBb27Cd3823297719C1332a
        tokenOut: wstETH,
        isBuffer: false
      }
    ];
  }

  // sDAI -> wstETH (V3, 3 hops through wrapped tokens)
  // Path: sDAI -> waGnoGNO (pool) -> waGnowstETH (pool) -> wstETH (buffer unwrap)
  if (tokenLower === sDAI.toLowerCase()) {
    return [
      // Step 1: sDAI -> waGnoGNO in V3 pool
      {
        pool: V3_sDAI_waGnoGNO_POOL,           // 0xD1D7Fa8871d84d0E77020fc28B7Cd5718C446522
        tokenOut: WAGNO_GNO,                    // 0x7c16F0185A26Db0AE7a9377f23BC18ea7ce5d644
        isBuffer: false
      },
      // Step 2: waGnoGNO -> waGnowstETH in V3 pool
      {
        pool: V3_waGnoGNO_waGnowstETH_POOL,    // 0x272d6BE442E30D7c87390eDEb9B96f1E84cEcD8d
        tokenOut: WAGNO_WSTETH,                 // 0x773CDA0CADe2A3d86E6D4e30699d40bB95174ff2
        isBuffer: false
      },
      // Step 3: Unwrap waGnowstETH -> wstETH via V3 buffer
      {
        pool: WAGNO_WSTETH,                     // 0x773CDA0CADe2A3d86E6D4e30699d40bB95174ff2
        tokenOut: wstETH,                       // 0x6C76971f98945AE98dD7d4DFcA8711ebea946eA6
        isBuffer: true
      }
    ];
  }

  // Already wstETH
  if (tokenLower === wstETH.toLowerCase()) {
    return [];
  }

  return null;
}

/**
 * Get V3 path from intermediate token to sDAI
 * This builds complete V3 paths from intermediate tokens to sDAI using Aave wrapped tokens
 * Based on the working Solidity test: test_getAmountOutV3_CRC_to_sDAI
 * @param intermediateToken - The intermediate token address (WETH, WBTC, sDAI, wstETH)
 * @returns V3SwapPathStep[] or null if no path exists (empty array if already sDAI)
 */
export function getV3PathToSDAI(intermediateToken: Address): V3SwapPathStep[] | null {
  const tokenLower = intermediateToken.toLowerCase();

  // WETH -> sDAI (V3, 4 hops through Aave wrapped tokens)
  // Path: WETH -> waGnoWETH (buffer) -> waGnowstETH -> waGnoGNO -> sDAI
  if (tokenLower === WETH.toLowerCase()) {
    return [
      // Step 1: Wrap WETH -> waGnoWETH via V3 buffer
      {
        pool: WAGNO_WETH,                // 0x57f664882F762FA37903FC864e2B633D384B411A
        tokenOut: WAGNO_WETH,             // Same as pool for buffer wrap
        isBuffer: true
      },
      // Step 2: Swap waGnoWETH -> waGnowstETH in V3 pool
      {
        pool: V3_waGnoWETH_waGnowstETH_POOL,  // 0x6e6bb18449fCF15B79EFa2CfA70ACF7593088029
        tokenOut: WAGNO_WSTETH,                // 0x773CDA0CADe2A3d86E6D4e30699d40bB95174ff2
        isBuffer: false
      },
      // Step 3: Swap waGnowstETH -> waGnoGNO in V3 pool
      {
        pool: V3_waGnoGNO_waGnowstETH_POOL,    // 0x272d6BE442E30D7c87390eDEb9B96f1E84cEcD8d
        tokenOut: WAGNO_GNO,                    // 0x7c16F0185A26Db0AE7a9377f23BC18ea7ce5d644
        isBuffer: false
      },
      // Step 4: Swap waGnoGNO -> sDAI in V3 pool
      {
        pool: V3_sDAI_waGnoGNO_POOL,           // 0xD1D7Fa8871d84d0E77020fc28B7Cd5718C446522
        tokenOut: sDAI,                         // 0xaf204776c7245bF4147c2612BF6e5972Ee483701
        isBuffer: false
      }
    ];
  }

  // WBTC -> sDAI would need a different path (not implemented yet)
  if (tokenLower === WBTC.toLowerCase()) {
    return null;  // TODO: Implement if needed
  }

  // sDAI is already sDAI
  if (tokenLower === sDAI.toLowerCase()) {
    return [];
  }

  // wstETH -> sDAI would need to go through the reverse path
  if (tokenLower === wstETH.toLowerCase()) {
    return null;  // TODO: Implement if needed
  }

  return null;
}
