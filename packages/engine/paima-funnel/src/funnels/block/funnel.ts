import { ENV, doLog, timeout } from '@paima/utils';
import type { ChainData, ChainFunnel, PresyncChainData } from '@paima/runtime';
import { getBaseChainDataMulti, getBaseChainDataSingle } from '../../reading';
import { getUngroupedCdeData } from '../../cde/reading';
import { composeChainData, groupCdeData } from '../../utils';
import { BaseFunnel } from '../BaseFunnel';
import type { FunnelSharedData } from '../BaseFunnel';
import { RpcCacheEntry, RpcRequestState } from '../FunnelCache';
import type { PoolClient } from 'pg';

const GET_BLOCK_NUMBER_TIMEOUT = 5000;

export class BlockFunnel extends BaseFunnel implements ChainFunnel {
  protected constructor(sharedData: FunnelSharedData, dbTx: PoolClient) {
    super(sharedData, dbTx);
    // TODO: replace once TS5 decorators are better supported
    this.readData.bind(this);
    this.readPresyncData.bind(this);
    this.getDbTx.bind(this);
  }

  public override async readData(blockHeight: number): Promise<ChainData[]> {
    const [fromBlock, toBlock] = await this.adjustBlockHeightRange(
      blockHeight,
      ENV.DEFAULT_FUNNEL_GROUP_SIZE
    );

    if (fromBlock < 0 || toBlock < fromBlock) {
      return [];
    }

    if (toBlock === fromBlock) {
      doLog(`Block funnel ${ENV.CHAIN_ID}: #${toBlock}`);
      return await this.internalReadDataSingle(fromBlock);
    } else {
      doLog(`Block funnel ${ENV.CHAIN_ID}: #${fromBlock}-${toBlock}`);
      return await this.internalReadDataMulti(fromBlock, toBlock);
    }
  }

  /**
   * Will return [-1, -2] if the range is determined to be empty.
   * It should be enough to check that fromBlock >= 0,
   * but this will also fail a fromBlock <= toBlock check.
   */
  private adjustBlockHeightRange = async (
    firstBlockHeight: number,
    blockCount: number
  ): Promise<[number, number]> => {
    const ERR_RESULT: [number, number] = [-1, -2];

    const latestBlockQueryState = this.sharedData.cacheManager.cacheEntries[
      RpcCacheEntry.SYMBOL
    ]?.getState(ENV.CHAIN_ID);
    if (latestBlockQueryState?.state !== RpcRequestState.HasResult) {
      throw new Error(`[funnel] latest block cache entry not found`);
    }

    const fromBlock = Math.max(0, firstBlockHeight);
    const toBlock = Math.min(latestBlockQueryState.result, firstBlockHeight + blockCount - 1);

    if (fromBlock <= toBlock) {
      return [fromBlock, toBlock];
    } else {
      return ERR_RESULT;
    }
  };

  private internalReadDataSingle = async (blockNumber: number): Promise<ChainData[]> => {
    if (blockNumber < 0) {
      return [];
    }
    try {
      const [baseChainData, cdeData] = await Promise.all([
        getBaseChainDataSingle(this.sharedData.web3, this.sharedData.paimaL2Contract, blockNumber),
        getUngroupedCdeData(
          this.sharedData.web3,
          this.sharedData.extensions,
          blockNumber,
          blockNumber
        ),
      ]);

      return [
        {
          ...baseChainData,
          extensionDatums: cdeData.flat(),
        },
      ];
    } catch (err) {
      doLog(`[funnel] at ${blockNumber} caught ${err}`);
      throw err;
    }
  };

  private internalReadDataMulti = async (
    fromBlock: number,
    toBlock: number
  ): Promise<ChainData[]> => {
    if (toBlock < fromBlock || fromBlock < 0) {
      return [];
    }
    try {
      const [baseChainData, ungroupedCdeData] = await Promise.all([
        getBaseChainDataMulti(
          this.sharedData.web3,
          this.sharedData.paimaL2Contract,
          fromBlock,
          toBlock
        ),
        getUngroupedCdeData(this.sharedData.web3, this.sharedData.extensions, fromBlock, toBlock),
      ]);
      const cdeData = groupCdeData(fromBlock, toBlock, ungroupedCdeData);
      return composeChainData(baseChainData, cdeData);
    } catch (err) {
      doLog(`[funnel] at ${fromBlock}-${toBlock} caught ${err}`);
      throw err;
    }
  };

  public override async readPresyncData(
    fromBlock: number,
    toBlock: number
  ): Promise<PresyncChainData[]> {
    try {
      toBlock = Math.min(toBlock, ENV.START_BLOCKHEIGHT);
      fromBlock = Math.max(fromBlock, 0);
      if (fromBlock > toBlock) {
        return [];
      }

      const ungroupedCdeData = await getUngroupedCdeData(
        this.sharedData.web3,
        this.sharedData.extensions,
        fromBlock,
        toBlock
      );
      return groupCdeData(fromBlock, toBlock, ungroupedCdeData);
    } catch (err) {
      doLog(`[paima-funnel::readPresyncData] Exception occurred while reading blocks: ${err}`);
      throw err;
    }
  }

  public static async recoverState(
    sharedData: FunnelSharedData,
    dbTx: PoolClient
  ): Promise<BlockFunnel> {
    // we always write to this cache instead of reading from it
    // as other funnels used may want to read from this cached data

    const latestBlock: number = await timeout(
      sharedData.web3.eth.getBlockNumber(),
      GET_BLOCK_NUMBER_TIMEOUT
    );
    const cacheEntry = ((): RpcCacheEntry => {
      const entry = sharedData.cacheManager.cacheEntries[RpcCacheEntry.SYMBOL];
      if (entry != null) return entry;

      const newEntry = new RpcCacheEntry();
      sharedData.cacheManager.cacheEntries[RpcCacheEntry.SYMBOL] = newEntry;
      return newEntry;
    })();

    cacheEntry.updateState(ENV.CHAIN_ID, latestBlock);

    return new BlockFunnel(sharedData, dbTx);
  }
}
