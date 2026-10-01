import { expect } from "chai";
import hre from "hardhat";
import { keccak256, toHex, type Address, type Hex } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

async function fixture() {
  const [deployer, burner, recipient] = await hre.viem.getWalletClients();
  const singleton = await hre.viem.deployContract("Safe");
  const proxy = await hre.viem.deployContract("SafeProxy", [singleton.address]);
  const safe = await hre.viem.getContractAt("Safe", proxy.address);
  const passkey = await hre.viem.deployContract("Mock1271Signer");
  const delay = await hre.viem.deployContract("ZodiacDelayV1_1_1", [safe.address, safe.address, safe.address, 10n, 60n]);
  const guard = await hre.viem.deployContract("TieredSpendingGuard", [[
    safe.address,
    passkey.address,
    burner.account.address,
    delay.address,
    86400n,
    0n,
  ]]);
  const owners = [passkey.address, burner.account.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  await safe.write.setup([
    owners,
    1n,
    ZERO,
    "0x",
    ZERO,
    ZERO,
    0n,
    ZERO,
  ], { account: deployer.account });
  return { deployer, burner, recipient, safe, passkey, guard };
}

describe("TieredSpendingGuard exact signatures", () => {
  it("two-owner config exposes only safe, passkey, Burner, Delay, and period fields", async () => {
    const artifact = await hre.artifacts.readArtifact("TieredSpendingGuard");
    const constructorAbi = artifact.abi.find((entry) => entry.type === "constructor");
    const constructorFields = constructorAbi?.inputs[0].components.map((component) => component.name);
    expect(constructorFields).to.deep.equal(["safe", "passkey", "burner", "delay", "periodSeconds", "periodAnchor"]);

    const [deployer, burner] = await hre.viem.getWalletClients();
    const singleton = await hre.viem.deployContract("Safe");
    const proxy = await hre.viem.deployContract("SafeProxy", [singleton.address]);
    const safe = await hre.viem.getContractAt("Safe", proxy.address);
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const delay = await hre.viem.deployContract("ZodiacDelayV1_1_1", [safe.address, safe.address, safe.address, 10n, 60n]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[
      safe.address,
      passkey.address,
      burner.account.address,
      delay.address,
      86400n,
      0n,
    ]]);
    const owners = [passkey.address, burner.account.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await safe.write.setup([
      owners,
      1n,
      ZERO,
      "0x",
      ZERO,
      ZERO,
      0n,
      ZERO,
    ], { account: deployer.account });

    const config = await guard.read.config();
    expect(config).to.have.length(6);
    expect(config.map((value) => typeof value)).to.deep.equal(["string", "string", "string", "string", "bigint", "bigint"]);
    expect((await safe.read.getOwners()).map((owner) => owner.toLowerCase())).to.deep.equal(owners.map((owner) => owner.toLowerCase()));
  });

  it("reconstructs the Safe hash with the pre-increment nonce and binds every Safe field", async () => {
    const { safe, guard, recipient } = await fixture();
    const data = "0x12345678" as Hex;
    const common = [recipient.account.address, 7n, data, 0, 0n, 0n, 0n, ZERO, ZERO, 0n] as const;
    const expected = await safe.read.getTransactionHash(common);
    expect(await guard.read.computeSafeTransactionHash(common)).to.equal(expected);

    for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const changed = [...common] as unknown[];
      if (index === 0) changed[index] = guard.address;
      else if (index === 1) changed[index] = 8n;
      else if (index === 2) changed[index] = "0x12345679";
      else if (index === 3) changed[index] = 1;
      else if (index === 7 || index === 8) changed[index] = guard.address;
      else changed[index] = (changed[index] as bigint) + 1n;
      expect(await guard.read.computeSafeTransactionHash(changed as never)).to.not.equal(expected);
    }
  });

  it("requires one canonical Safe contract signature naming the configured passkey", async () => {
    const { guard, passkey } = await fixture();
    const valid = `0x${passkey.address.slice(2).padStart(64, "0")}${toHex(65n, { size: 32 }).slice(2)}00${toHex(0n, { size: 32 }).slice(2)}` as Hex;
    const decoded = await guard.read.decodePasskeySignature([valid]);
    expect(decoded[0].toLowerCase()).to.equal(passkey.address.toLowerCase());
    expect(decoded[1]).to.equal(97n);
    await expect(guard.read.decodePasskeySignature(["0x"])).to.be.rejectedWith("Malformed");
    await expect(guard.read.decodePasskeySignature([`${valid}00` as Hex])).to.be.rejectedWith("Trailing");
    const approvedHash = `${valid.slice(0, 130)}01` as Hex;
    await expect(guard.read.decodePasskeySignature([approvedHash])).to.be.rejected;
    const nonCanonical = `0x01${valid.slice(4)}` as Hex;
    await expect(guard.read.decodePasskeySignature([nonCanonical])).to.be.rejected;
  });

  it("uses a terminal typed envelope for the Burner signature", async () => {
    const { guard, passkey, burner } = await fixture();
    const safeSignature = `0x${passkey.address.slice(2).padStart(64, "0")}${toHex(65n, { size: 32 }).slice(2)}00${toHex(0n, { size: 32 }).slice(2)}` as Hex;
    const burnerSignature = `0x${"11".repeat(64)}` as Hex;
    const typeHash = await guard.read.BURNER_SIGNATURE_TYPE_HASH();
    const extension = `0x${burnerSignature.slice(2)}${toHex((burnerSignature.length - 2) / 2, { size: 32 }).slice(2)}${typeHash.slice(2)}` as Hex;
    expect(await guard.read.decodeBurnerExtension([`${safeSignature}${extension.slice(2)}` as Hex])).to.equal(burnerSignature);
    await expect(guard.read.decodeBurnerExtension([safeSignature])).to.be.rejectedWith("Missing");
    await expect(guard.read.decodeBurnerExtension([`${safeSignature}${extension.slice(2)}${extension.slice(2)}` as Hex])).to.be.rejected;
  });
});
