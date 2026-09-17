// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import {ITransactionGuard} from "@safe-global/safe-smart-account/contracts/base/GuardManager.sol";
import {IModuleGuard} from "@safe-global/safe-smart-account/contracts/base/ModuleManager.sol";

interface ISafeOwnerMaintenance {
    function removeOwner(address prevOwner, address owner, uint256 threshold) external;
    function addOwnerWithThreshold(address owner, uint256 threshold) external;
}

interface IGuardSignerRepair {
    function repairSigner(uint8 role, address expectedOld, address replacement) external;
}

/// @notice The only delegatecall target permitted for dual-guard maintenance.
/// @dev This contract has one operation by design. It is executed by the Safe
///      through the verified Delay module; both setter calls are self-calls of
///      the Safe and therefore either both commit or both roll back.
contract GuardReplacementMaintenance {
    bytes32 private constant LOCK_SLOT = 0x5c0a4f8b1c122f2b1c07f4f9d0f8cba2557d5f7d4a2a4c8a2e4a5c9fb19f0c11;
    bytes32 private constant GUARD_SLOT = 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8;
    bytes32 private constant MODULE_GUARD_SLOT = 0xb104e0b93118902c651344349b610029d694cfdec91c589c91ebafbcd0289947;

    address public immutable safe;
    address public immutable delay;

    error OnlyDelay();
    error WrongExecutionContext();
    error ReentrantCall();
    error InvalidReplacement();
    error SetterFailed();

    constructor(address expectedSafe, address verifiedDelay) {
        require(expectedSafe != address(0) && verifiedDelay != address(0), "zero address");
        safe = expectedSafe;
        delay = verifiedDelay;
    }

    function replaceGuards(address expectedGuard, address replacement) external {
        if (msg.sender != delay) revert OnlyDelay();
        if (address(this) != safe) revert WrongExecutionContext();
        bool locked;
        assembly { locked := sload(LOCK_SLOT) }
        if (locked) revert ReentrantCall();
        assembly { sstore(LOCK_SLOT, 1) }

        address currentGuard;
        address currentModuleGuard;
        assembly {
            currentGuard := sload(GUARD_SLOT)
            currentModuleGuard := sload(MODULE_GUARD_SLOT)
        }
        if (expectedGuard == address(0) || replacement == address(0) || currentGuard != expectedGuard || currentModuleGuard != expectedGuard) revert InvalidReplacement();
        if (!_supports(replacement, type(ITransactionGuard).interfaceId) || !_supports(replacement, type(IModuleGuard).interfaceId)) revert InvalidReplacement();

        (bool first,) = address(this).call(abi.encodeWithSignature("setGuard(address)", replacement));
        (bool second,) = address(this).call(abi.encodeWithSignature("setModuleGuard(address)", replacement));
        (bool configured,) = replacement.call(abi.encodeWithSignature("setMaintenance(address)", address(this)));
        if (!first || !second || !configured) revert SetterFailed();
        assembly { sstore(LOCK_SLOT, 0) }
    }

    function replaceSigner(
        address guard,
        uint8 role,
        address expectedOld,
        address replacement,
        address previousOwner,
        uint256 threshold
    ) external {
        if (msg.sender != delay) revert OnlyDelay();
        if (address(this) != safe) revert WrongExecutionContext();
        if (guard == address(0) || expectedOld == address(0) || replacement == address(0) || previousOwner == address(0) || replacement == expectedOld) revert InvalidReplacement();
        (bool repaired,) = guard.call(abi.encodeWithSelector(IGuardSignerRepair.repairSigner.selector, role, expectedOld, replacement));
        (bool removed,) = address(this).call(abi.encodeWithSelector(ISafeOwnerMaintenance.removeOwner.selector, previousOwner, expectedOld, threshold));
        (bool added,) = address(this).call(abi.encodeWithSelector(ISafeOwnerMaintenance.addOwnerWithThreshold.selector, replacement, threshold));
        if (!repaired || !removed || !added) revert SetterFailed();
    }

    function _supports(address candidate, bytes4 interfaceId) private view returns (bool supported) {
        (bool ok, bytes memory result) = candidate.staticcall(abi.encodeWithSelector(0x01ffc9a7, interfaceId));
        supported = ok && result.length == 32 && abi.decode(result, (bool));
    }
}
