import {
  sequencerModule,
  SequencerModule,
  StorageDependencyMinimumDependencies,
} from "@proto-kit/sequencer";
import { ChildContainerProvider, DependencyFactory } from "@proto-kit/common";

import {
  PrismaConnection,
  PrismaDatabaseConfig,
  PrismaDatabaseConnection,
} from "./PrismaDatabaseConnection";
import {
  RedisConnection,
  RedisConnectionConfig,
  RedisConnectionModule,
} from "./RedisConnection";
import { PrismaClient, Prisma } from "@prisma/client";
import { DefaultArgs } from "@prisma/client/runtime/library";
import { RedisClientType } from "redis";

export interface PrismaRedisCombinedConfig {
  prisma: PrismaDatabaseConfig;
  redis: RedisConnectionConfig;
}

@sequencerModule()
export class PrismaRedisDatabase
  extends SequencerModule<PrismaRedisCombinedConfig>
  implements DependencyFactory, PrismaConnection, RedisConnection
{
  public prisma: PrismaDatabaseConnection;

  public redis: RedisConnectionModule;

  public constructor() {
    super();
    this.prisma = new PrismaDatabaseConnection();
    this.redis = new RedisConnectionModule();
  }

  public get prismaClient(): PrismaClient {
    return this.prisma.prismaClient;
  }

  public get redisClient(): RedisClientType {
    return this.redis.redisClient;
  }

  public create(childContainerProvider: ChildContainerProvider) {
    super.create(childContainerProvider);
    this.prisma.create(childContainerProvider);
    this.redis.create(childContainerProvider);
  }

  public dependencies(): StorageDependencyMinimumDependencies {
    return {
      ...this.prisma.dependencies(),
      ...this.redis.dependencies(),
    };
  }

  public async start(): Promise<void> {
    this.prisma.config = this.config.prisma;
    await this.prisma.start();

    this.redis.config = this.config.redis;
    await this.redis.start();
  }
}
