import type { Address, Hex } from '@aboutcircles/sdk-types';
import {
  Contract,
  BaseGroupContract,
  LiftERC20Contract,
  InflationaryCirclesContract
} from '@aboutcircles/sdk-core';

import { arbbotOracleAbi, arbbotV2Abi, erc20Abi, baseGroupMintRouterAbi } from '../abi/index.js';

/**
 * ArbbotOracle Contract Wrapper - New BalancerOracle implementation
 */
export class ArbbotOracleContract extends Contract<typeof arbbotOracleAbi> {
  constructor(config: { address: Address; rpcUrl: string }) {
    super({
      address: config.address,
      abi: arbbotOracleAbi,
      rpcUrl: config.rpcUrl,
    });
  }

  /**
   * Get intermediate token (stable asset) from a CRC pool (V2)
   */
  async getIntermediateTokenV2(
    crcToken: Address,
    poolId: string
  ): Promise<Address> {
    return this.read('getIntermediateTokenV2', [
      crcToken,
      poolId,
    ]) as Promise<Address>;
  }

  /**
   * Get intermediate token (stable asset) from a CRC pool (V3)
   */
  async getIntermediateTokenV3(
    crcToken: Address,
    v3PoolAddress: Address
  ): Promise<Address> {
    return this.read('getIntermediateTokenV3', [
      crcToken,
      v3PoolAddress,
    ]) as Promise<Address>;
  }

  /**
   * Build forward swap steps (wstETH -> CRC) for V2 pools
   * Uses the unified buildForwardSwapSteps function with V2 parameters
   */
  async buildForwardSwapStepsV2(
    crcToken: Address,
    v2PoolId: string
  ): Promise<readonly { poolId: string; tokenOut: Address }[]> {
    return this.read('buildForwardSwapStepsV2', [
      crcToken,
      v2PoolId,
    ], { from: '0x0000000000000000000000000000000000000000' as Address }) as Promise<readonly { poolId: string; tokenOut: Address }[]>;
  }

  /**
   * Build backward swap steps (CRC -> wstETH) for V2 pools
   * Uses the unified buildBackwardSwapSteps function with V2 parameters
   */
  async buildBackwardSwapStepsV2(
    crcToken: Address,
    v2PoolId: string
  ): Promise<readonly { poolId: string; tokenOut: Address }[]> {
    return this.read('buildBackwardSwapStepsV2', [
      crcToken,
      v2PoolId
    ], { from: '0x0000000000000000000000000000000000000000' as Address }) as Promise<readonly { poolId: string; tokenOut: Address }[]>;
  }

  /**
   * Get output amount for V2 swap path (exact input)
   */
  async getAmountOutV2(
    tokenIn: Address,
    amountIn: bigint,
    steps: readonly { poolId: string; tokenOut: Address }[]
  ): Promise<bigint> {
    return this.read('getAmountOutV2', [
      tokenIn,
      amountIn,
      steps,
    ], { from: '0x0000000000000000000000000000000000000000' as Address }) as Promise<bigint>;
  }

  /**
   * Get input amount required for V2 swap path (exact output)
   */
  async getAmountInV2(
    tokenIn: Address,
    amountOut: bigint,
    steps: readonly { poolId: string; tokenOut: Address }[]
  ): Promise<bigint> {
    return this.read('getAmountInV2', [
      tokenIn,
      amountOut,
      steps,
    ], { from: '0x0000000000000000000000000000000000000000' as Address }) as Promise<bigint>;
  }

  /**
   * Get wstETH constant address
   */
  async WSTETH(): Promise<Address> {
    return this.read('WSTETH', []) as Promise<Address>;
  }

  /**
   * Get sDAI constant address
   */
  async SDAI(): Promise<Address> {
    return this.read('SDAI', []) as Promise<Address>;
  }

  /**
   * Get wstETH-sDAI pool ID (V2)
   */
  async WSTETH_SDAI_POOL_V2(): Promise<string> {
    return this.read('WSTETH_SDAI_POOL_V2', []) as Promise<string>;
  }

  /**
   * Build forward swap steps (wstETH -> CRC) for V3 pools
   * Returns SwapPathStep[] format for V3 BatchRouter queries
   */
  async buildForwardSwapStepsV3(
    crcToken: Address,
    v3PoolAddress: Address
  ): Promise<readonly { pool: Address; tokenOut: Address; isBuffer: boolean }[]> {
    return this.read('buildForwardSwapStepsV3', [
      crcToken,
      v3PoolAddress,
    ]) as Promise<readonly { pool: Address; tokenOut: Address; isBuffer: boolean }[]>;
  }

  /**
   * Build backward swap steps (CRC -> wstETH) for V3 pools
   * Returns SwapPathStep[] format for V3 BatchRouter queries
   */
  async buildBackwardSwapStepsV3(
    crcToken: Address,
    v3PoolAddress: Address
  ): Promise<readonly { pool: Address; tokenOut: Address; isBuffer: boolean }[]> {
    return this.read('buildBackwardSwapStepsV3', [
      crcToken,
      v3PoolAddress,
    ]) as Promise<readonly { pool: Address; tokenOut: Address; isBuffer: boolean }[]>;
  }

  /**
   * Get output amount for V3 swap path (exact input)
   */
  async getAmountOutV3(
    tokenIn: Address,
    amountIn: bigint,
    steps: readonly { pool: Address; tokenOut: Address; isBuffer: boolean }[]
  ): Promise<bigint> {
    return this.read('getAmountOutV3', [
      tokenIn,
      amountIn,
      steps,
    ], { from: '0x0000000000000000000000000000000000000000' as Address }) as Promise<bigint>;
  }

  /**
   * Get input amount required for V3 swap path (exact output)
   */
  async getAmountInV3(
    tokenIn: Address,
    amountOut: bigint,
    steps: readonly { pool: Address; tokenOut: Address; isBuffer: boolean }[]
  ): Promise<bigint> {
    return this.read('getAmountInV3', [
      tokenIn,
      amountOut,
      steps,
    ], { from: '0x0000000000000000000000000000000000000000' as Address }) as Promise<bigint>;
  }
}

/**
 * ArbbotV2 Contract Wrapper
 */
export class ArbbotV2Contract extends Contract<typeof arbbotV2Abi> {
  constructor(config: { address: Address; rpcUrl: string }) {
    super({
      address: config.address,
      abi: arbbotV2Abi,
      rpcUrl: config.rpcUrl,
    });
  }

  forceTrust(trustee: Address): { to: Address; data: Hex } {
    return {
      to: this.address,
      data: this.encodeWrite('forceTrust', [trustee]),
    };
  }

  /**
   * Build forward swap config for V2 pools (wstETH -> CRC)
   */
  async buildForwardSwapConfigV2(
    crcToken: Address,
    v2PoolId: string,
    amount: bigint
  ): Promise<readonly { isV3: boolean; swapData: Hex }[]> {
    const result = await this.read('buildForwardSwapConfigV2', [
      crcToken,
      v2PoolId,
      amount,
    ]) as readonly [boolean, Hex][];

    // Map tuple array to object array, keeping swapData as-is
    return result.map(([isV3, swapData]) => ({ isV3, swapData }));
  }

  /**
   * Build forward swap config for V3 pools (wstETH -> CRC)
   */
  async buildForwardSwapConfigV3(
    crcToken: Address,
    v3PoolAddress: Address,
    amount: bigint
  ): Promise<readonly { isV3: boolean; swapData: Hex }[]> {
    const result = await this.read('buildForwardSwapConfigV3', [
      crcToken,
      v3PoolAddress,
      amount,
    ]) as readonly [boolean, Hex][];

    // Map tuple array to object array, keeping swapData as-is
    return result.map(([isV3, swapData]) => ({ isV3, swapData }));
  }

  /**
   * Build backward swap config for V2 pools (CRC -> wstETH)
   */
  async buildBackwardSwapConfigV2(
    crcToken: Address,
    v2PoolId: string,
    amount: bigint
  ): Promise<readonly { isV3: boolean; swapData: Hex }[]> {
    const result = await this.read('buildBackwardSwapConfigV2', [
      crcToken,
      v2PoolId,
      amount,
    ]) as readonly [boolean, Hex][];

    // Map tuple array to object array, keeping swapData as-is
    return result.map(([isV3, swapData]) => ({ isV3, swapData }));
  }

  /**
   * Build backward swap config for V3 pools (CRC -> wstETH)
   */
  async buildBackwardSwapConfigV3(
    crcToken: Address,
    v3PoolAddress: Address,
    amount: bigint
  ): Promise<readonly { isV3: boolean; swapData: Hex }[]> {
    const result = await this.read('buildBackwardSwapConfigV3', [
      crcToken,
      v3PoolAddress,
      amount,
    ]) as readonly [boolean, Hex][];

    // Map tuple array to object array, keeping swapData as-is
    return result.map(([isV3, swapData]) => ({ isV3, swapData }));
  }

  /**
   * Execute arbitrage with new ArbitrageParams structure
   */
  executeArbitrage(
    params: {
      flashLoanToken: Address;
      flashLoanAmount: bigint;
      unwrapFlashloanToken: boolean;
      flashloanUnderlyingToken: Address;
      forwardSwaps: readonly { isV3: boolean; swapData: Hex }[];
      sourceCRC: Address;
      targetCRC: Address;
      transitiveePath: {
        flowVertices: readonly Address[];
        flow: readonly { streamSinkId: number; amount: bigint }[];
        streams: readonly { sourceCoordinate: number; flowEdgeIds: readonly number[]; data: Uint8Array | Hex }[];
        packedCoordinates: Uint8Array | Hex | string;
      };
      backwardSwaps: readonly { isV3: boolean; swapData: Hex }[];
      wrapBackToFlashloan: boolean;
      backwardOutputToken: Address;
      collector: Address;
    }
  ): { to: Address; data: Hex } {
    return {
      to: this.address,
      data: this.encodeWrite('executeArbitrage', [params]),
    };
  }
}

// Re-export BaseGroupContract from @aboutcircles/sdk-core
export { BaseGroupContract };

// Re-export LiftERC20Contract from @aboutcircles/sdk-core
export { LiftERC20Contract };
// Also export as ERC20LiftContract for backwards compatibility
export { LiftERC20Contract as ERC20LiftContract };

/**
 * ERC20 Contract Wrapper
 */
export class ERC20Contract extends Contract<typeof erc20Abi> {
  constructor(config: { address: Address; rpcUrl: string }) {
    super({
      address: config.address,
      abi: erc20Abi,
      rpcUrl: config.rpcUrl,
    });
  }

  async balanceOf(owner: Address): Promise<bigint> {
    return this.read('balanceOf', [owner]) as Promise<bigint>;
  }

  approve(spender: Address, value: bigint): { to: Address; data: Hex } {
    return {
      to: this.address,
      data: this.encodeWrite('approve', [spender, value]),
    };
  }
}

// Re-export InflationaryCirclesContract from @aboutcircles/sdk-core
export { InflationaryCirclesContract };
// Also export as InflationaryTokenContract for backwards compatibility
export { InflationaryCirclesContract as InflationaryTokenContract };

/**
 * BaseGroupMintRouter Contract Wrapper
 */
export class BaseGroupMintRouterContract extends Contract<typeof baseGroupMintRouterAbi> {
  constructor(config: { address: Address; rpcUrl: string }) {
    super({
      address: config.address,
      abi: baseGroupMintRouterAbi,
      rpcUrl: config.rpcUrl,
    });
  }

  enableCRCForRouting(crcList: Address[]): { to: Address; data: Hex } {
    return {
      to: this.address,
      data: this.encodeWrite('enableCRCForRouting', [crcList]),
    };
  }

  disableCRCForRouting(crcList: Address[]): { to: Address; data: Hex } {
    return {
      to: this.address,
      data: this.encodeWrite('disableCRCForRouting', [crcList]),
    };
  }
}
