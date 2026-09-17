// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import {ISafe} from "@safe-global/safe-smart-account/contracts/interfaces/ISafe.sol";
import {Enum} from "@safe-global/safe-smart-account/contracts/libraries/Enum.sol";

library PolicyDigest {
    function safeTransactionHash(
        address safe,
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 nonce
    ) internal view returns (bytes32) {
        return ISafe(payable(safe)).getTransactionHash(to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce);
    }

    function moduleTransactionHash(
        address safe,
        address module,
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation
    ) internal view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, safe, module, to, value, keccak256(data), operation));
    }
}
