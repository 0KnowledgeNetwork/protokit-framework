/* eslint-disable max-statements */
/* eslint-disable unicorn/filename-case */
import { Poseidon, PrivateKey, Provable, PublicKey, UInt64 } from "o1js";
import log from "loglevel";
import { RuntimeModulesRecord } from "@proto-kit/module";

import { TestingAppChain } from "../../src/appChain/TestingAppChain";

import {
  Balance,
  Balances,
  BalancesEvents,
  BalancesKey,
  TokenId,
} from "./Balances";
import { PoolKey, XYK } from "./XYK";
import uniqBy from "lodash/uniqBy";
import { VanillaProtocolModulesRecord } from "@proto-kit/library";

interface RuntimeModules extends RuntimeModulesRecord {
  Balances: typeof Balances;
  XYK: typeof XYK;
}

// eslint-disable-next-line jest/require-hook
let nonce = 0;

describe("xyk", () => {
  const aliceKey = PrivateKey.fromBase58(
    "EKFEMDTUV2VJwcGmCwNKde3iE1cbu7MHhzBqTmBtGAd6PdsLTifY"
  );
  const alice = aliceKey.toPublicKey();

  const tokenInId = TokenId.from(0);
  const tokenOutId = TokenId.from(1);

  const pool = PoolKey.fromTokenIdPair(tokenInId, tokenOutId);

  let chain: TestingAppChain<RuntimeModules, VanillaProtocolModulesRecord>;

  let balances: Balances;
  let xyk: XYK;
  let events: BalancesEvents[] = [];

  const balanceToMint = 10_000n;
  const initialLiquidityA = 1000n;
  const initialLiquidityB = 2000n;

  const balanceToSell = 100n;
  const balanceToBuy = 200n;

  async function getBalance(tokenId: TokenId, address: PublicKey) {
    return await chain.query.runtime.Balances.balances.get(
      new BalancesKey({
        tokenId,
        address,
      })
    );
  }

  beforeAll(async () => {
    chain = TestingAppChain.fromRuntime({
      modules: {
        Balances,
        XYK,
      },
    });

    chain.configurePartial({
      Runtime: {
        Balances: {
          totalSupply: UInt64.from(1_000_000n),
        },

        XYK: {},
      },
    });

    await chain.start();

    chain.setSigner(aliceKey);

    balances = chain.runtime.resolve("Balances");
    xyk = chain.runtime.resolve("XYK");

    balances.events.on("setBalance", (key, balance) => {
      events.push({ setBalance: [key, balance] });
      // eslint-disable-next-line etc/no-assign-mutated-array
      events = uniqBy(events.reverse(), (event) =>
        Poseidon.hash(BalancesKey.toFields(event.setBalance[0])).toString()
      );
    });
  }, 30_000);

  afterEach(() => {
    events = [];
  });

  it("should mint balance for alice", async () => {
    expect.assertions(2);

    const tx1 = await chain.transaction(alice, () => {
      balances.mint(tokenInId, alice, Balance.from(balanceToMint));
    });

    await tx1.sign();
    await tx1.send();

    const block = await chain.produceBlock();

    const tx2 = await chain.transaction(alice, () => {
      balances.mint(tokenOutId, alice, Balance.from(balanceToMint));
    });

    await tx2.sign();
    await tx2.send();

    await chain.produceBlock();

    const balanceIn = await getBalance(tokenInId, alice);
    const balanceOut = await getBalance(tokenOutId, alice);

    expect(balanceIn?.toBigInt()).toBe(balanceToMint);
    expect(balanceOut?.toBigInt()).toBe(balanceToMint);

    Provable.log("After mint events:");
    events.forEach((event) => {
      Provable.log(event);
    });
  }, 30_000);

  it("should create a pool", async () => {
    expect.assertions(2);

    const tx = await chain.transaction(alice, () => {
      xyk.createPool(
        tokenInId,
        tokenOutId,
        Balance.from(initialLiquidityA),
        Balance.from(initialLiquidityB)
      );
    });

    await tx.sign();
    await tx.send();

    await chain.produceBlock();

    const balanceIn = await getBalance(tokenInId, alice);
    const balanceOut = await getBalance(tokenOutId, alice);

    expect(balanceIn?.toBigInt()).toBe(balanceToMint - initialLiquidityA);
    expect(balanceOut?.toBigInt()).toBe(balanceToMint - initialLiquidityB);
  }, 30_000);

  it("should sell tokenIn", async () => {
    expect.assertions(2);

    const balanceInBefore = await getBalance(tokenInId, alice);
    const balanceOutBefore = await getBalance(tokenOutId, alice);

    const tx = await chain.transaction(alice, () => {
      xyk.sell(
        tokenInId,
        tokenOutId,
        Balance.from(balanceToSell),
        Balance.from(100n)
      );
    });

    await tx.sign();
    await tx.send();

    await chain.produceBlock();

    const balanceInAfter = await getBalance(tokenInId, alice);
    const balanceOutAfter = await getBalance(tokenOutId, alice);

    Provable.log("Sell balances", {
      balanceInBefore,
      balanceInAfter,
      balanceOutBefore,
      balanceOutAfter,
    });

    expect(balanceInAfter?.toBigInt()).toBe(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      balanceInBefore!.toBigInt() - balanceToSell
    );

    expect(balanceOutAfter?.toBigInt()).toBe(
      // 181 = expected calculated amount to receive
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      balanceOutBefore!.toBigInt() + 181n
    );
  }, 30_000);

  it("should buy tokenOut", async () => {
    expect.assertions(2);

    const balanceInBefore = await getBalance(tokenInId, alice);
    const balanceOutBefore = await getBalance(tokenOutId, alice);

    const tx = await chain.transaction(
      alice,
      () => {
        xyk.buy(
          tokenInId,
          tokenOutId,
          Balance.from(balanceToBuy),
          Balance.from(10_000n)
        );
      },
      { nonce }
    );

    await tx.sign();
    await tx.send();
    nonce += 1;

    await chain.produceBlock();

    const balanceInAfter = await getBalance(tokenInId, alice);
    const balanceOutAfter = await getBalance(tokenOutId, alice);

    expect(balanceOutAfter?.toBigInt()).toBe(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      balanceOutBefore!.toBigInt() + balanceToBuy
    );

    expect(balanceInAfter?.toBigInt()).toBe(
      // 404 = expected calculated amount in
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      balanceInBefore!.toBigInt() - 135n
    );
  }, 30_000);
});
