// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import {IERC165} from "@safe-global/safe-smart-account/contracts/interfaces/IERC165.sol";
import {ITransactionGuard} from "@safe-global/safe-smart-account/contracts/base/GuardManager.sol";
import {IModuleGuard} from "@safe-global/safe-smart-account/contracts/base/ModuleManager.sol";
import {ISafe} from "@safe-global/safe-smart-account/contracts/interfaces/ISafe.sol";
import {Enum} from "@safe-global/safe-smart-account/contracts/libraries/Enum.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {PolicyDigest} from "./libraries/PolicyDigest.sol";
import {SafeSignatureDecoder} from "./libraries/SafeSignatureDecoder.sol";

contract TieredSpendingGuard is ITransactionGuard, IModuleGuard {
    enum AuthorizationTier { Base, StepUp, DelayedProposal, Emergency }

    struct GuardConfig {
        address safe;
        address passkey;
        address burner;
        address recovery;
        address delay;
        uint64 periodSeconds;
        uint64 periodAnchor;
    }

    bytes32 public constant BURNER_SIGNATURE_TYPE_HASH = keccak256("TieredSpendingGuard.BurnerSignature.v1");
    bytes4 private constant ERC1271_MAGICVALUE = 0x1626ba7e;

    GuardConfig public config;
    mapping(bytes32 => bool) public burnerAuthorizationUsed;
    bool private checking;

    error OnlySafe();
    error ReentrantCheck();
    error NonZeroSafeTxGas();
    error NonZeroGasPrice();
    error InvalidConfig();
    error InvalidPasskeySignature();
    error MissingBurnerExtension();
    error MalformedBurnerExtension();
    error WrongBurnerExtensionType();
    error InvalidBurnerExtensionLength();
    error InvalidBurnerSignature();
    error ExecutionFailed();
    error NoPendingCheck();

    constructor(GuardConfig memory initialConfig) {
        if (
            initialConfig.safe == address(0) || initialConfig.passkey == address(0) || initialConfig.burner == address(0) ||
            initialConfig.recovery == address(0) || initialConfig.periodSeconds == 0
        ) revert InvalidConfig();
        config = initialConfig;
    }

    modifier onlySafe() {
        if (msg.sender != config.safe) revert OnlySafe();
        _;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(ITransactionGuard).interfaceId || interfaceId == type(IModuleGuard).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function computeSafeTransactionHash(
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
    ) external view returns (bytes32) {
        return PolicyDigest.safeTransactionHash(config.safe, to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce);
    }

    function decodePasskeySignature(bytes calldata signatures) external view returns (address signer, uint256 ownerEnd) {
        (signer, ownerEnd) = SafeSignatureDecoder.decode(signatures);
        SafeSignatureDecoder.requireNoTrailingData(signatures, ownerEnd);
    }

    function decodeBurnerExtension(bytes calldata signatures) external view returns (bytes calldata burnerSignature) {
        (, uint256 ownerEnd) = SafeSignatureDecoder.decode(signatures);
        return _burnerExtension(signatures, ownerEnd);
    }

    function checkTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes calldata signatures,
        address executor
    ) external override onlySafe {
        if (checking) revert ReentrantCheck();
        if (safeTxGas != 0) revert NonZeroSafeTxGas();
        if (gasPrice != 0) revert NonZeroGasPrice();
        checking = true;

        uint256 currentNonce = ISafe(payable(config.safe)).nonce();
        if (currentNonce == 0) revert InvalidPasskeySignature();
        bytes32 txHash = PolicyDigest.safeTransactionHash(config.safe, to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, currentNonce - 1);
        (, uint256 ownerEnd) = SafeSignatureDecoder.decode(signatures);
        (address passkeySigner,) = SafeSignatureDecoder.decode(signatures);
        if (passkeySigner != config.passkey) revert InvalidPasskeySignature();
        try ISafe(payable(config.safe)).checkNSignatures(executor, txHash, signatures, 1) {} catch { revert InvalidPasskeySignature(); }

        if (signatures.length > ownerEnd) {
            bytes calldata burnerSignature = _burnerExtension(signatures, ownerEnd);
            if (!SignatureChecker.isValidSignatureNow(config.burner, txHash, burnerSignature)) revert InvalidBurnerSignature();
            bytes32 authorization = keccak256(abi.encode(txHash, keccak256(burnerSignature)));
            if (burnerAuthorizationUsed[authorization]) revert InvalidBurnerSignature();
            burnerAuthorizationUsed[authorization] = true;
        }
    }

    function checkAfterExecution(bytes32, bool success) external override onlySafe {
        if (!checking) revert NoPendingCheck();
        if (!success) revert ExecutionFailed();
        checking = false;
    }

    function checkModuleTransaction(address to, uint256 value, bytes calldata data, Enum.Operation operation, address module)
        external override onlySafe returns (bytes32 moduleTxHash)
    {
        if (checking) revert ReentrantCheck();
        if (module != config.delay) revert InvalidConfig();
        checking = true;
        return PolicyDigest.moduleTransactionHash(config.safe, module, to, value, data, operation);
    }

    function checkAfterModuleExecution(bytes32, bool success) external override onlySafe {
        if (!checking) revert NoPendingCheck();
        if (!success) revert ExecutionFailed();
        checking = false;
    }

    function _burnerExtension(bytes calldata signatures, uint256 ownerEnd) internal pure returns (bytes calldata burnerSignature) {
        if (signatures.length == ownerEnd) revert MissingBurnerExtension();
        if (signatures.length < ownerEnd + 64) revert MalformedBurnerExtension();
        uint256 typeOffset = signatures.length - 32;
        if (bytes32(signatures[typeOffset:typeOffset + 32]) != BURNER_SIGNATURE_TYPE_HASH) revert WrongBurnerExtensionType();
        uint256 lengthOffset = signatures.length - 64;
        uint256 payloadLength = uint256(bytes32(signatures[lengthOffset:lengthOffset + 32]));
        if (payloadLength == 0 || payloadLength + 64 > signatures.length - ownerEnd) revert InvalidBurnerExtensionLength();
        if (ownerEnd + payloadLength + 64 != signatures.length) revert InvalidBurnerExtensionLength();
        return signatures[ownerEnd:ownerEnd + payloadLength];
    }
}
