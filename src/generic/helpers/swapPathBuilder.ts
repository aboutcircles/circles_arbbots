import { Address } from "../interfaces/index.js";
import {
  V2SwapPath,
  V3SwapPathStep,
} from "./poolConfig.js";
import { encodeAbiParameters, parseAbiParameters } from "viem";

/**
 * Swap configuration for CirclesArbbotV2
 */
export interface SwapConfig {
  isV3: boolean;
  swapData: `0x${string}`;
  wrapAaveToken: boolean;
  aaveToken: Address;
}

/**
 * V2 Batch Swap Step (matches CirclesArbbotV2.BatchSwapStep)
 */
export interface BatchSwapStep {
  poolId: `0x${string}`;
  assetInIndex: bigint;
  assetOutIndex: bigint;
  amount: bigint;
  userData: `0x${string}`;
}

/**
 * Balancer V3 Swap Path Exact Amount In
 */
export interface SwapPathExactAmountIn {
  tokenIn: Address;
  steps: V3SwapPathStep[];
  exactAmountIn: bigint;
  minAmountOut: bigint;
}

/**
 * Build V2 swap configuration
 * @param steps - V2 swap path steps
 * @param amountIn - Input amount (only used for first step)
 * @returns SwapConfig for V2 swap
 */
export function buildV2SwapConfig(
  steps: V2SwapPath[],
  amountIn: bigint = 0n
): SwapConfig {
  // Build assets array: [tokenIn, step[0].tokenOut, step[1].tokenOut, ...]
  const assets: Address[] = [steps[0].tokenIn];
  for (const step of steps) {
    assets.push(step.tokenOut);
  }

  // Build batch swap steps
  const batchSwapSteps: BatchSwapStep[] = steps.map((step, i) => ({
    poolId: step.poolId as `0x${string}`,
    assetInIndex: BigInt(i),
    assetOutIndex: BigInt(i + 1),
    amount: i === 0 ? amountIn : 0n,
    userData: "0x" as `0x${string}`,
  }));

  // Build limits array
  // For GIVEN_IN: limits[0] = max input, limits[last] = min output (negative)
  const limits: bigint[] = new Array(assets.length).fill(0n);
  limits[0] = amountIn;
  // Set min output to 0 (will be overridden by contract with actual minAmountOut)
  limits[limits.length - 1] = 0n;

  // Encode swap data: (BatchSwapStep[], address[], int256[])
  const swapData = encodeAbiParameters(
    parseAbiParameters("tuple(bytes32,uint256,uint256,uint256,bytes)[], address[], int256[]"),
    [
      batchSwapSteps.map(step => [
        step.poolId,
        step.assetInIndex,
        step.assetOutIndex,
        step.amount,
        step.userData
      ]),
      assets,
      limits.map(l => BigInt(l))
    ]
  ) as `0x${string}`;

  return {
    isV3: false,
    swapData,
    wrapAaveToken: false,
    aaveToken: "0x0000000000000000000000000000000000000000" as Address,
  };
}

/**
 * Build V3 swap configuration
 * @param tokenIn - Input token address
 * @param steps - V3 swap path steps
 * @param amountIn - Input amount
 * @param minAmountOut - Minimum output amount
 * @returns SwapConfig for V3 swap
 */
export function buildV3SwapConfig(
  tokenIn: Address,
  steps: V3SwapPathStep[],
  amountIn: bigint = 0n,
  minAmountOut: bigint = 0n
): SwapConfig {
  const swapPath: SwapPathExactAmountIn = {
    tokenIn,
    steps,
    exactAmountIn: amountIn,
    minAmountOut,
  };

  // Encode as SwapPathExactAmountIn
  const swapData = encodeAbiParameters(
    parseAbiParameters("tuple(address,tuple(address,address,bool)[],uint256,uint256)"),
    [
      [
        swapPath.tokenIn,
        swapPath.steps.map(s => [s.pool, s.tokenOut, s.isBuffer]),
        swapPath.exactAmountIn,
        swapPath.minAmountOut
      ]
    ]
  ) as `0x${string}`;

  return {
    isV3: true,
    swapData,
    wrapAaveToken: false,
    aaveToken: "0x0000000000000000000000000000000000000000" as Address,
  };
}

/**
 * Helper: Get expected final token from a swap path
 */
export function getFinalTokenFromV2Path(steps: V2SwapPath[]): Address {
  return steps[steps.length - 1].tokenOut;
}

export function getFinalTokenFromV3Path(steps: V3SwapPathStep[]): Address {
  return steps[steps.length - 1].tokenOut;
}
