import type { Address, Hex } from '@aboutcircles/sdk-types';
import {
  Contract,
  BaseGroupContract,
  LiftERC20Contract,
  InflationaryCirclesContract
} from '@aboutcircles/sdk-core';

import { arbbotOracleAbi, arbbotV2Abi, erc20Abi, baseGroupMintRouterAbi } from '../abi';

/**
 * ArbbotOracle Contract Wrapper
 */
export const arbbotOracleContract = new Contract({
  address: '0x...',
  abi: erc20Abi,
  rpcUrl: 'https://...'
});
export class ArbbotOracleContract extends Contract<typeof arbbotOracleAbi> {
  constructor(config: { address: Address; rpcUrl: string }) {
    super({
      address: config.address,
      abi: arbbotOracleAbi,
      rpcUrl: config.rpcUrl,
    });
  }

  async checkCRCArbitrage(
    crc1Token: Address,
    crc1PoolId: string,
    crc2Token: Address,
    crc2PoolId: string,
    crcAmount: bigint
  ): Promise<readonly [boolean, bigint, bigint]> {
    return this.read('checkCRCArbitrage', [
      crc1Token,
      crc1PoolId,
      crc2Token,
      crc2PoolId,
      crcAmount,
    ]) as Promise<readonly [boolean, bigint, bigint]>;
  }

  async getSwapQuoteToDAI(
    crcErc20Token: Address,
    crcPoolId: string,
    amountIn: bigint
  ): Promise<bigint> {
    return this.read('getSwapQuoteToDAI', [
      crcErc20Token,
      crcPoolId,
      amountIn,
    ]) as Promise<bigint>;
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

  executeArbitrageWithFlashLoan(
    crcBuy: Address,
    crcPoolBuy: string,
    crcSell: Address,
    crcPoolSell: string,
    crcAmount: bigint,
    estimatedAmountIn: bigint,
    pathFlow: {
      flowVertices: readonly Address[];
      flow: readonly { streamSinkId: number; amount: bigint }[];
      streams: readonly { sourceCoordinate: number; flowEdgeIds: readonly number[]; data: Uint8Array | Hex }[];
      packedCoordinates: Uint8Array | Hex | string;
    },
    recipient: Address
  ): { to: Address; data: Hex } {
    return {
      to: this.address,
      data: this.encodeWrite('executeArbitrageWithFlashLoan', [
        crcBuy,
        crcPoolBuy,
        crcSell,
        crcPoolSell,
        crcAmount,
        estimatedAmountIn,
        pathFlow,
        recipient,
      ]),
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
