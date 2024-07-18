import { inject } from "tsyringe";
import { log, noop } from "@proto-kit/common";
import { ACTIONS_EMPTY_HASH } from "@proto-kit/protocol";

import { Mempool } from "../../../mempool/Mempool";
import {
  sequencerModule,
  SequencerModule,
} from "../../../sequencer/builder/SequencerModule";
import { BlockQueue } from "../../../storage/repositories/BlockStorage";
import { PendingTransaction } from "../../../mempool/PendingTransaction";
import { AsyncMerkleTreeStore } from "../../../state/async/AsyncMerkleTreeStore";
import { AsyncStateService } from "../../../state/async/AsyncStateService";
import { Block, BlockWithResult } from "../../../storage/model/Block";
import { CachedStateService } from "../../../state/state/CachedStateService";
import { MessageStorage } from "../../../storage/repositories/MessageStorage";

import { TransactionExecutionService } from "./TransactionExecutionService";

export interface BlockConfig {
  allowEmptyBlock?: boolean;
}

@sequencerModule()
export class UnprovenProducerModule extends SequencerModule<BlockConfig> {
  private productionInProgress = false;

  public constructor(
    @inject("Mempool") private readonly mempool: Mempool,
    @inject("MessageStorage") private readonly messageStorage: MessageStorage,
    @inject("UnprovenStateService")
    private readonly unprovenStateService: AsyncStateService,
    @inject("UnprovenMerkleStore")
    private readonly unprovenMerkleStore: AsyncMerkleTreeStore,
    @inject("BlockQueue")
    private readonly blockQueue: BlockQueue,
    @inject("BlockTreeStore")
    private readonly blockTreeStore: AsyncMerkleTreeStore,
    private readonly executionService: TransactionExecutionService
  ) {
    super();
  }

  private allowEmptyBlock() {
    return this.config.allowEmptyBlock ?? true;
  }

  public async tryProduceUnprovenBlock(): Promise<BlockWithResult | undefined> {
    if (!this.productionInProgress) {
      try {
        const block = await this.produceUnprovenBlock();

        if (block === undefined) {
          if (!this.allowEmptyBlock()) {
            log.info("No transactions in mempool, skipping production");
          } else {
            log.error("Something wrong happened, skipping block");
          }
          return undefined;
        }

        log.info(`Produced unproven block (${block.transactions.length} txs)`);

        // Generate metadata for next block

        // TODO: make async of production in the future
        const result = await this.executionService.generateMetadataForNextBlock(
          block,
          this.unprovenMerkleStore,
          this.blockTreeStore,
          true
        );

        return {
          block,
          result,
        };
      } catch (error: unknown) {
        if (error instanceof Error) {
          throw error;
        } else {
          log.error(error);
        }
      } finally {
        this.productionInProgress = false;
      }
    }
    return undefined;
  }

  private async collectProductionData(): Promise<{
    txs: PendingTransaction[];
    metadata: BlockWithResult;
  }> {
    const txs = await this.mempool.getTxs();

    const parentBlock = await this.blockQueue.getLatestBlock();

    if (parentBlock === undefined) {
      log.debug(
        "No unproven block metadata given, assuming first block, generating genesis metadata"
      );
    }

    const messages = await this.messageStorage.getMessages(
      parentBlock?.block.toMessagesHash.toString() ??
        ACTIONS_EMPTY_HASH.toString()
    );
    const metadata = parentBlock ?? BlockWithResult.createEmpty();

    log.debug(
      `Unproven block collected, ${txs.length} txs, ${messages.length} messages`
    );

    return {
      txs: messages.concat(txs),
      metadata,
    };
  }

  private async produceUnprovenBlock(): Promise<Block | undefined> {
    this.productionInProgress = true;

    const { txs, metadata } = await this.collectProductionData();

    // Skip production if no transactions are available for now
    if (txs.length === 0 && !this.allowEmptyBlock()) {
      return undefined;
    }

    const cachedStateService = new CachedStateService(
      this.unprovenStateService
    );

    const block = await this.executionService.createUnprovenBlock(
      cachedStateService,
      txs,
      metadata,
      this.allowEmptyBlock()
    );

    await cachedStateService.mergeIntoParent();

    this.productionInProgress = false;

    return block;
  }

  public async start() {
    noop();
  }
}
