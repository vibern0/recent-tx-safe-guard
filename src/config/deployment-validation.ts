import { isAddress, type Address } from "viem";
import type { DependencyName, DeploymentRecord } from "./deployments";

export const EXPECTED_RELEASES: Readonly<Record<DependencyName, readonly string[]>> = Object.freeze({
  safeSingleton: ["1.5.0"],
  safeProxyFactory: ["1.5.0"],
  passkeySignerFactory: ["0.2.0"],
  passkeySignerVerifier: ["0.2.0"],
  multiSend: ["1.5.0"],
  guard: ["task7-reviewed"],
  delay: ["1.1.1"],
});

export const VULNERABLE_DELAY_RELEASES = new Set(["1.1.0"]);
export const DEPENDENCIES = Object.freeze(Object.keys(EXPECTED_RELEASES) as DependencyName[]);

export function deploymentAddressError(dependency: DependencyName, record: DeploymentRecord): string | undefined {
  if (!record.address) return `${dependency} has no official deployment address`;
  if (!isAddress(record.address)) return `${dependency} has invalid address`;
  if (record.address.toLowerCase() === "0x0000000000000000000000000000000000000000") return `${dependency} has zero address`;
  return undefined;
}

export function deploymentReleaseError(dependency: DependencyName, record: DeploymentRecord): string | undefined {
  if (dependency === "delay" && VULNERABLE_DELAY_RELEASES.has(record.version)) return `known-vulnerable Delay release ${record.version}`;
  if (!EXPECTED_RELEASES[dependency].includes(record.version)) return `unknown release ${record.version} for ${dependency}`;
  if (dependency === "safeSingleton" && record.supportsModuleGuards !== true) return `Safe release ${record.version} lacks module guards`;
  return undefined;
}

export function validatedDeploymentAddress(dependency: DependencyName, record: DeploymentRecord): Address {
  if (!record.address || !isAddress(record.address) || record.address.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    throw new Error(deploymentAddressError(dependency, record) ?? `${dependency} has invalid address`);
  }
  return record.address;
}
