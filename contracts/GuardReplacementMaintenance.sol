// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import {ITransactionGuard} from "@safe-global/safe-smart-account/contracts/base/GuardManager.sol";
import {IModuleGuard} from "@safe-global/safe-smart-account/contracts/base/ModuleManager.sol";

interface ISafeOwnerMaintenance {
    /// @notice Removes an owner from the Safe and sets the resulting threshold.
    function removeOwner(address prevOwner, address owner, uint256 threshold) external;

    /// @notice Adds an owner to the Safe and sets the resulting threshold.
    function addOwnerWithThreshold(address owner, uint256 threshold) external;
}

interface IGuardSignerRepair {
    /// @notice Returns the guard's configured Safe, signers, Delay, and period data.
    function config() external view returns (address safe, address passkey, address burner, address recovery, address delay, uint64 periodSeconds, uint64 periodAnchor);

    /// @notice Replaces one signer role inside the guard configuration.
    function repairSigner(uint8 role, address expectedOld, address replacement) external;
}

interface IGuardMaintenance {
    /// @notice Returns the maintenance helper recorded by the guard.
    function maintenance() external view returns (address);
}

interface IERC1271Evidence {
    /// @notice ERC-1271 signature check used as passkey-contract evidence.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

/// @notice The only delegatecall target permitted for dual-guard maintenance.
/// @dev This contract has one operation by design. It is executed by the Safe
///      through the verified Delay module; both setter calls are self-calls of
///      the Safe and therefore either both commit or both roll back.
contract GuardReplacementMaintenance {
    // Filled from the reviewed TieredSpendingGuard artifact during the Task 6
    // hardening build. Replacement is intentionally implementation-bound.
    bytes32 private constant APPROVED_GUARD_RUNTIME_CODE_HASH = 0x2ce73f0d8f57f18abfb7198fa0b027f1f4d025169518dac8b12c5da172b6f377;
    bytes4 private constant ERC1271_MAGICVALUE = 0x1626ba7e;
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

    /// @param expectedSafe Safe that must execute this helper by delegatecall.
    /// @param verifiedDelay Delay module allowed to trigger the maintenance call.
    constructor(address expectedSafe, address verifiedDelay) {
        require(expectedSafe != address(0) && verifiedDelay != address(0), "zero address");
        safe = expectedSafe;
        delay = verifiedDelay;
    }

    /// @notice Atomically replaces both Safe guard slots with a reviewed guard.
    /// @dev Must be called by Delay while executing in the Safe's storage context.
    /// @param expectedGuard Current transaction and module guard address.
    /// @param replacement New guard whose runtime code hash and interfaces are checked.
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
        if (!_isApprovedGuardImplementation(replacement)) revert InvalidReplacement();
        if (!_supports(replacement, type(ITransactionGuard).interfaceId) || !_supports(replacement, type(IModuleGuard).interfaceId)) revert InvalidReplacement();

        (bool first,) = address(this).call(abi.encodeWithSignature("setGuard(address)", replacement));
        (bool second,) = address(this).call(abi.encodeWithSignature("setModuleGuard(address)", replacement));
        (bool configured,) = replacement.call(abi.encodeWithSignature("setMaintenance(address)", address(this)));
        if (!first || !second || !configured || !_matchesGuardConfiguration(replacement, address(0), 0) || !_hasMaintenance(replacement)) revert SetterFailed();
        assembly { sstore(LOCK_SLOT, 0) }
    }

    /// @notice Atomically updates the guard signer and Safe owner list.
    /// @dev Used by delayed signer repair so Safe ownership and guard policy do
    ///      not diverge. Role 0 replacements must provide ERC-1271 evidence.
    /// @param guard Current guard installed in both Safe guard slots.
    /// @param role Signer role: 0 passkey, 1 Burner, 2 recovery.
    /// @param expectedOld Current signer that must be present in guard config.
    /// @param replacement New signer for both guard config and Safe owners.
    /// @param previousOwner Previous Safe linked-list owner before expectedOld.
    /// @param threshold Safe owner threshold to preserve after owner changes.
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
        address currentGuard;
        address currentModuleGuard;
        assembly {
            currentGuard := sload(GUARD_SLOT)
            currentModuleGuard := sload(MODULE_GUARD_SLOT)
        }
        if (currentGuard != guard || currentModuleGuard != guard || !_matchesGuardConfiguration(guard, expectedOld, role)) revert InvalidReplacement();
        if (role == 0 && !_hasContract1271Evidence(replacement)) revert InvalidReplacement();
        (bool repaired,) = guard.call(abi.encodeWithSelector(IGuardSignerRepair.repairSigner.selector, role, expectedOld, replacement));
        (bool removed,) = address(this).call(abi.encodeWithSelector(ISafeOwnerMaintenance.removeOwner.selector, previousOwner, expectedOld, threshold));
        (bool added,) = address(this).call(abi.encodeWithSelector(ISafeOwnerMaintenance.addOwnerWithThreshold.selector, replacement, threshold));
        if (!repaired || !removed || !added) revert SetterFailed();
    }

    /// @dev Checks ERC-165 support on a candidate replacement.
    function _supports(address candidate, bytes4 interfaceId) private view returns (bool supported) {
        (bool ok, bytes memory result) = candidate.staticcall(abi.encodeWithSelector(0x01ffc9a7, interfaceId));
        supported = ok && result.length == 32 && abi.decode(result, (bool));
    }

    /// @dev Requires nonempty code and the reviewed guard runtime code hash.
    function _isApprovedGuardImplementation(address candidate) private view returns (bool approved) {
        uint256 codeSize;
        bytes32 codeHash;
        assembly {
            codeSize := extcodesize(candidate)
            codeHash := extcodehash(candidate)
        }
        approved = codeSize != 0 && codeHash == APPROVED_GUARD_RUNTIME_CODE_HASH;
    }

    /// @dev Confirms a passkey replacement is a contract exposing ERC-1271.
    function _hasContract1271Evidence(address candidate) private view returns (bool) {
        uint256 codeSize;
        assembly { codeSize := extcodesize(candidate) }
        if (codeSize == 0) return false;
        (bool ok, bytes memory result) = candidate.staticcall(
            abi.encodeWithSelector(IERC1271Evidence.isValidSignature.selector, bytes32(0), bytes("") )
        );
        return ok && result.length == 32 && abi.decode(result, (bytes4)) == ERC1271_MAGICVALUE;
    }

    /// @dev Confirms a replacement guard recorded this helper as maintenance.
    function _hasMaintenance(address candidate) private view returns (bool) {
        (bool ok, bytes memory result) = candidate.staticcall(abi.encodeWithSelector(IGuardMaintenance.maintenance.selector));
        return ok && result.length == 32 && abi.decode(result, (address)) == address(this);
    }

    /// @dev Checks the candidate guard still targets this Safe, Delay, and signer set.
    /// @param candidate Guard whose config is being checked.
    /// @param expectedOld Optional signer expected for the selected role.
    /// @param role Signer role to compare when expectedOld is provided.
    function _matchesGuardConfiguration(address candidate, address expectedOld, uint8 role) private view returns (bool) {
        (bool ok, bytes memory result) = candidate.staticcall(abi.encodeWithSelector(IGuardSignerRepair.config.selector));
        if (!ok || result.length != 224) return false;
        (address configuredSafe, address passkey, address burner, address recovery, address configuredDelay, uint64 periodSeconds,) = abi.decode(
            result,
            (address, address, address, address, address, uint64, uint64)
        );
        if (
            configuredSafe != safe || configuredDelay != delay || periodSeconds != 86400 ||
            passkey == address(0) || burner == address(0) || recovery == address(0) ||
            passkey == burner || passkey == recovery || burner == recovery
        ) return false;
        if (expectedOld == address(0)) return true;
        address configuredSigner = role == 0 ? passkey : role == 1 ? burner : role == 2 ? recovery : address(0);
        return configuredSigner == expectedOld;
    }
}
