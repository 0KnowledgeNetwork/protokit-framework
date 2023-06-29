import { method, runtimeModule, RuntimeModule } from "@yab/module";
import { Presets } from "@yab/common";
import { state } from "@yab/module/dist/state/decorator";
import { State } from "@yab/module/dist/state/State";
import { PublicKey, UInt64 } from "snarkyjs";
import { StateMap } from "@yab/module/dist/state/StateMap";
import { Admin } from "@yab/module/test/modules/Admin";
import { Option } from "@yab/protocol";

@runtimeModule()
export class Balance extends RuntimeModule<object> {
  public static presets = {} satisfies Presets<object>;

  @state() public totalSupply = State.from<UInt64>(UInt64);

  @state() public balances = StateMap.from<PublicKey, UInt64>(
    PublicKey,
    UInt64
  );

  public constructor(public admin: Admin) {
    super();
  }

  @method()
  public getTotalSupply() {
    this.totalSupply.get();
  }

  @method()
  public setTotalSupply() {
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    this.totalSupply.set(UInt64.from(20));
    this.admin.isAdmin(PublicKey.empty());
  }

  @method()
  public getBalance(address: PublicKey): Option<UInt64> {
    return this.balances.get(address);
  }

  @method()
  public setBalance(address: PublicKey, value: UInt64) {
    this.balances.set(address, value);
  }
}