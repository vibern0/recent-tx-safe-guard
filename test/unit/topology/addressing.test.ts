import { readFileSync } from "node:fs";
import { expect } from "chai";
import { type Address, type Hex } from "viem";
import { deriveComponentAddresses, deriveSafeProxyAddress } from "../../../src/topology/addressing";

const SAFE_PROXY_ARTIFACT = JSON.parse(
  readFileSync(
    "node_modules/@safe-global/safe-smart-account/build/artifacts/contracts/proxies/SafeProxy.sol/SafeProxy.json",
    "utf8",
  ),
) as { bytecode: Hex };

describe("address derivation", () => {
  it("derives the circular guard, Delay, and maintenance addresses from contiguous CREATE nonces", () => {
    expect(
      deriveComponentAddresses({
        deployer: "0x1111111111111111111111111111111111111111" as Address,
        startingNonce: 7n,
      }),
    ).to.deep.equal({
      guard: "0x34E0765525c4d4D837Dc20bcb458EdD206120e59",
      delay: "0x43CeE6586B589FE6F81637bf323121087f54FEF0",
      maintenance: "0xA1eD4d0134858BAe8B320F13C90ab97Fb8222677",
    });
  });

  it("rejects negative and overflowing CREATE nonces before deriving component addresses", () => {
    const deployer = "0x1111111111111111111111111111111111111111" as Address;

    expect(() => deriveComponentAddresses({ deployer, startingNonce: -1n })).to.throw("nonce");
    expect(() => deriveComponentAddresses({ deployer, startingNonce: (1n << 64n) - 2n })).to.throw("nonce");
  });

  it("matches Safe 1.5 createProxyWithNonce CREATE2 derivation for the canonical Sepolia factory", () => {
    const base = {
      factory: "0xA83c336B20401Af773B6219BA5027174338D1836" as Address,
      singleton: "0xFf51A5898e281Db6DfC7855790607438dF2ca44b" as Address,
      proxyCreationCode: SAFE_PROXY_ARTIFACT.bytecode,
      initializer: "0xdeadbeef" as Hex,
      saltNonce: 123n,
    };

    expect(deriveSafeProxyAddress(base)).to.equal("0x726D9e2CCB18b6c48cEa201B3640E788177257af");
    expect(deriveSafeProxyAddress({ ...base, initializer: "0xdeadbeee" as Hex })).to.equal(
      "0xD03Bee0C10F838CABAC02cB822feB0510c29DCC9",
    );
    expect(deriveSafeProxyAddress({ ...base, singleton: "0x0000000000000000000000000000000000000001" as Address })).to.not.equal(
      "0x726D9e2CCB18b6c48cEa201B3640E788177257af",
    );
    expect(deriveSafeProxyAddress({ ...base, factory: "0x0000000000000000000000000000000000000002" as Address })).to.not.equal(
      "0x726D9e2CCB18b6c48cEa201B3640E788177257af",
    );
    expect(deriveSafeProxyAddress({ ...base, saltNonce: 124n })).to.not.equal(
      "0x726D9e2CCB18b6c48cEa201B3640E788177257af",
    );
  });

  it("rejects invalid Safe proxy derivation inputs", () => {
    const base = {
      factory: "0xA83c336B20401Af773B6219BA5027174338D1836" as Address,
      singleton: "0xFf51A5898e281Db6DfC7855790607438dF2ca44b" as Address,
      proxyCreationCode: SAFE_PROXY_ARTIFACT.bytecode,
      initializer: "0xdeadbeef" as Hex,
      saltNonce: 123n,
    };

    expect(() => deriveSafeProxyAddress({ ...base, saltNonce: -1n })).to.throw("salt nonce");
    expect(() => deriveSafeProxyAddress({ ...base, proxyCreationCode: "0x" as Hex })).to.throw("proxy creation code");
  });
});
