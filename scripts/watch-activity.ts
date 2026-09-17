import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { decodeDelayLog, type DelayMonitoringContext } from "../src/monitoring/delay-events";
import { decodeGuardLog, type MonitorLog, type MonitoringIdentity } from "../src/monitoring/guard-events";
import { ActivityLedger, InMemoryActivityStore } from "../src/monitoring/ledger";
import { createStdoutNotifier } from "../src/monitoring/notifier";

function env(name: string): string { const value = process.env[name]; if (!value) throw new Error(`missing ${name}`); return value; }
function address(name: string): Address { return env(name) as Address; }
function asLog(log: { address: Address; blockNumber: bigint; blockHash: Hex; transactionHash: Hex; logIndex: number; topics: readonly Hex[]; data: Hex }): MonitorLog { return { ...log, chainId: Number(env("MONITOR_CHAIN_ID")) }; }

async function main(): Promise<void> {
  const chainId = Number(env("MONITOR_CHAIN_ID"));
  const safe = address("MONITOR_SAFE");
  const guard = address("MONITOR_GUARD");
  const delay = address("MONITOR_DELAY");
  const confirmations = Number(process.env.MONITOR_CONFIRMATIONS ?? "6");
  const fromBlock = BigInt(env("MONITOR_FROM_BLOCK"));
  const client = createPublicClient({ transport: http(env("MONITOR_RPC_URL")) });
  const latest = await client.getBlockNumber();
  const identity: MonitoringIdentity = { chainId, safe, guard, delay, confirmations };
  const delayContext: DelayMonitoringContext = { chainId, safe, delay, confirmations, cooldownSeconds: BigInt(env("MONITOR_COOLDOWN")), expirationSeconds: BigInt(process.env.MONITOR_EXPIRATION ?? "0") };
  const ledger = new ActivityLedger(new InMemoryActivityStore());
  const notifier = createStdoutNotifier();
  const [guardLogs, delayLogs] = await Promise.all([
    client.getLogs({ address: guard, fromBlock, toBlock: latest }),
    client.getLogs({ address: delay, fromBlock, toBlock: latest }),
  ]);
  for (const raw of guardLogs) {
    const log = asLog(raw);
    try {
      const alert = decodeGuardLog(log, identity, latest);
      if (alert && ledger.accept({ chainId, blockHash: log.blockHash, transactionHash: log.transactionHash, logIndex: log.logIndex }, alert)) await notifier.notify(alert);
    } catch (error) { console.error(`ignored malformed guard log ${log.transactionHash}:${log.logIndex}`, error); }
  }
  const delayAbi = parseAbi(["function getTxHash(uint256) view returns (bytes32)", "function getTxCreatedAt(uint256) view returns (uint256)"]);
  for (const raw of delayLogs) {
    const log = asLog(raw);
    try {
      const observedAt = (await client.getBlock({ blockNumber: log.blockNumber })).timestamp;
      const alert = decodeDelayLog(log, delayContext, latest, observedAt);
      if (alert.queueNonce !== undefined) {
        const [txHash, createdAt] = await Promise.all([
          client.readContract({ address: delay, abi: delayAbi, functionName: "getTxHash", args: [alert.queueNonce] }),
          client.readContract({ address: delay, abi: delayAbi, functionName: "getTxCreatedAt", args: [alert.queueNonce] }),
        ]);
        if (alert.queueFingerprint && txHash.toLowerCase() !== alert.queueFingerprint.toLowerCase()) throw new Error("queue hash binding mismatch");
        if (alert.createdAt !== undefined && createdAt !== alert.createdAt) throw new Error("queue creation binding mismatch");
      }
      if (ledger.accept({ chainId, blockHash: log.blockHash, transactionHash: log.transactionHash, logIndex: log.logIndex }, alert)) await notifier.notify(alert);
    } catch (error) { console.error(`ignored malformed Delay log ${log.transactionHash}:${log.logIndex}`, error); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
