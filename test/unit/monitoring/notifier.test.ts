import { expect } from "chai";
import { getAddress } from "viem";
import { createWebhookNotifier, publicAlert, type ActivityAlert, type Notifier } from "../../../src/monitoring/notifier";

const alert: ActivityAlert = {
  kind: "step-up-executed",
  chainId: 31337,
  safe: getAddress("0x0000000000000000000000000000000000000001"),
  guard: getAddress("0x0000000000000000000000000000000000000002"),
  transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
  blockNumber: 10n,
  logIndex: 0,
  token: getAddress("0x0000000000000000000000000000000000000004"),
  recipient: getAddress("0x0000000000000000000000000000000000000005"),
  amount: 25n,
  baseSpent: 7n,
  instantSpent: 25n,
  window: 1n,
};

const delayedQueued: ActivityAlert = {
  kind: "delayed-queued",
  chainId: 31337,
  safe: alert.safe,
  delay: getAddress("0x0000000000000000000000000000000000000002"),
  transactionHash: alert.transactionHash,
  blockNumber: 10n,
  logIndex: 0,
  queueNonce: 1n,
  queueFingerprint: alert.transactionHash,
  createdAt: 10n,
};

const delayedCancelled: ActivityAlert = {
  kind: "delayed-cancelled",
  chainId: 31337,
  safe: alert.safe,
  delay: delayedQueued.delay,
  transactionHash: alert.transactionHash,
  blockNumber: 10n,
  logIndex: 0,
  cancelledThrough: 1n,
};

const alerts: readonly ActivityAlert[] = [alert, delayedQueued, delayedCancelled];

describe("non-authorizing notifiers", () => {
  it("exposes only notification and does not retain a signing or execution capability", async () => {
    const calls: unknown[] = [];
    const notifier: Notifier = { notify: async value => { calls.push(value); } };
    expect(Object.keys(notifier)).to.deep.equal(["notify"]);
    await notifier.notify(alert);
    expect(calls).to.have.length(1);
  });

  it("sends only serialized public alert data to a webhook", async () => {
    let body = "";
    const notifier = createWebhookNotifier("https://example.invalid/hook", async (_url, init) => {
      body = String(init?.body);
      return new Response(null, { status: 204 });
    });
    await notifier.notify(alert);
    expect(body).to.contain('"kind":"step-up-executed"');
    expect(body).to.not.contain("privateKey");
    expect(body).to.not.contain("sign");
  });

  it("rejects unknown and sensitive alert fields at the notifier boundary", async () => {
    expect(() => publicAlert({ ...alert, privateKey: "secret" } as never)).to.throw(/unknown|sensitive/i);
    expect(() => publicAlert({ ...alert, delay: alert.guard } as never)).to.throw(/unknown|sensitive/i);
    expect(() => publicAlert({ ...alert, amount: "25" } as never)).to.throw(/type|required/i);
    expect(() => publicAlert({ ...alert, recipient: undefined } as never)).to.throw(/required/i);
  });

  for (const field of ["safe", "transactionHash", "blockNumber", "logIndex"] as const) {
    it(`rejects omission of common field ${field} for every alert kind`, () => {
      for (const value of alerts) {
        const omitted = { ...value } as Record<string, unknown>;
        delete omitted[field];
        expect(() => publicAlert(omitted as never)).to.throw(new RegExp(`required.*${field}`));
      }
    });
  }

  it("rejects a type mismatch in each common public alert field", () => {
    expect(() => publicAlert({ ...alert, safe: 1 } as never)).to.throw(/type/i);
    expect(() => publicAlert({ ...alert, transactionHash: 1 } as never)).to.throw(/type/i);
    expect(() => publicAlert({ ...alert, blockNumber: 10 } as never)).to.throw(/type/i);
    expect(() => publicAlert({ ...alert, logIndex: 0n } as never)).to.throw(/type/i);
  });
});
