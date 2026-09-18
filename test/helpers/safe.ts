import type { Address } from "viem";
import { SAFE_TX_TYPES } from "../../src/signers/types";

export const ZERO = "0x0000000000000000000000000000000000000000" as Address;
export const safeTxTypes = { SafeTx: SAFE_TX_TYPES } as const;
export const fn = (name: string, inputs: readonly object[]) => [{ name, type: "function", stateMutability: "nonpayable", inputs, outputs: [] }] as const;
export const transferAbi = fn("transfer", [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }]);
export const queueAbi = fn("execTransactionFromModule", [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" }]);
