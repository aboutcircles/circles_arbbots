/**
 * Minimal Private Key Contract Runner
 * Used for executing transactions directly with a private key
 */

import type { Hex, PublicClient, TransactionReceipt, WalletClient } from 'viem';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Local types to avoid external dependencies
export type Address = `0x${string}`;

export interface TransactionRequest {
  to?: Address;
  from?: Address;
  data?: Hex;
  value?: bigint;
  gas?: bigint;
  gasPrice?: bigint;
}

/**
 * Minimal private key contract runner for transaction execution
 */
export class PrivateKeyContractRunner {
  public address?: Address;
  public publicClient: PublicClient;
  private walletClient?: WalletClient;
  private privateKey: Hex;
  private rpcUrl: string;

  constructor(
    publicClient: PublicClient,
    privateKey: Hex,
    rpcUrl: string
  ) {
    this.publicClient = publicClient;
    this.privateKey = privateKey;
    this.rpcUrl = rpcUrl;
  }

  /**
   * Initialize the runner
   */
  async init(): Promise<void> {
    const account = privateKeyToAccount(this.privateKey);
    this.address = account.address as Address;

    this.walletClient = createWalletClient({
      account,
      chain: this.publicClient.chain,
      transport: http(this.rpcUrl),
    });
  }

  /**
   * Send a transaction and wait for confirmation
   * @param tx - Transaction request with to and data fields
   * @returns Transaction receipt
   */
  async sendTransaction(tx: TransactionRequest): Promise<TransactionReceipt> {
    if (!this.walletClient || !this.address) {
      throw new Error('PrivateKeyContractRunner not initialized. Call init() first.');
    }

    // Send the transaction
    const hash = await this.walletClient.sendTransaction({
      account: this.walletClient.account!,
      to: tx.to!,
      data: tx.data,
      value: tx.value,
      gas: tx.gas,
      gasPrice: tx.gasPrice,
      chain: undefined,
    });

    // Wait for transaction receipt
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
    });

    // Check transaction status
    if (receipt.status === 'reverted') {
      throw new Error(
        `Transaction reverted: ${receipt.transactionHash} (block: ${receipt.blockNumber}, gas: ${receipt.gasUsed})`
      );
    }

    return receipt;
  }
}
