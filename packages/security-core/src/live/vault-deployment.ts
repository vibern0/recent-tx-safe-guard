import { concatHex, encodeAbiParameters, type Address, type Hex } from "viem";
import GuardArtifact from "../../artifacts/contracts/TieredSpendingGuard.sol/TieredSpendingGuard.json";
import SetupHelperArtifact from "../../artifacts/contracts/SafeAtomicSetupHelper.sol/SafeAtomicSetupHelper.json";
import MaintenanceArtifact from "../../artifacts/contracts/GuardReplacementMaintenance.sol/GuardReplacementMaintenance.json";
import { zodiacDelayCreationCode, type ZodiacDelayArtifact } from "../config/zodiac-delay";

type Artifact = Readonly<{ bytecode: Hex }>;

const guardArtifact = GuardArtifact as Artifact;
const setupHelperArtifact = SetupHelperArtifact as Artifact;
const maintenanceArtifact = MaintenanceArtifact as Artifact;

export type VaultPrerequisiteCreationCodes = Readonly<{
  setupHelper: Hex;
  guard: Hex;
  delay: Hex;
  maintenance: Hex;
}>;

export function buildVaultPrerequisiteCreationCodes(input: Readonly<{
  safe: Address;
  primaryPasskey: Address;
  ecdsaSecondary: Address;
  delay: Address;
  maintenance: Address;
  periodAnchor: bigint;
  cooldownSeconds: bigint;
  expirationSeconds: bigint;
  delayArtifact: ZodiacDelayArtifact;
}>): VaultPrerequisiteCreationCodes {
  const guard = concatHex([
    guardArtifact.bytecode,
    encodeAbiParameters(
      [{ type: "tuple", components: [{ type: "address", name: "safe" }, { type: "address", name: "passkey" }, { type: "address", name: "ecdsaSecondary" }, { type: "address", name: "delay" }, { type: "uint64", name: "periodSeconds" }, { type: "uint64", name: "periodAnchor" }] }],
      [[input.safe, input.primaryPasskey, input.ecdsaSecondary, input.delay, 86400n, input.periodAnchor]],
    ),
  ]);
  const maintenance = concatHex([
    maintenanceArtifact.bytecode,
    encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], [input.safe, input.delay, input.maintenance]),
  ]);

  return Object.freeze({
    setupHelper: setupHelperArtifact.bytecode,
    guard,
    delay: zodiacDelayCreationCode(input.delayArtifact, input),
    maintenance,
  });
}
