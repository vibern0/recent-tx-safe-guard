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

    struct AssetPolicy {
        uint256 basePerTransaction;
        uint256 stepUpPerTransaction;
        uint256 baseDailyLimit;
        uint256 instantDailyLimit;
    }

    struct SpendState {
        uint256 window;
        uint256 baseSpent;
        uint256 instantSpent;
    }

    bytes32 public constant BURNER_SIGNATURE_TYPE_HASH = keccak256("TieredSpendingGuard.BurnerSignature.v1");
    bytes4 private constant ERC1271_MAGICVALUE = 0x1626ba7e;

    GuardConfig public config;
    mapping(address => AssetPolicy) public assetPolicy;
    mapping(address => SpendState) public spendState;
    mapping(address => mapping(address => bool)) public allowedRecipient;
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
    error UnsupportedTransfer();
    error InvalidAssetPolicy();
    error TransferExceedsLimit();
    error RecipientNotAllowed();

    event TransferAuthorized(
        AuthorizationTier tier,
        address token,
        address recipient,
        uint256 amount,
        uint256 baseSpent,
        uint256 instantSpent,
        uint256 window
    );

    constructor(GuardConfig memory initialConfig) {
        if (
            initialConfig.safe == address(0) || initialConfig.passkey == address(0) || initialConfig.burner == address(0) ||
            initialConfig.recovery == address(0) || initialConfig.periodSeconds != 86400
        ) revert InvalidConfig();
        config = initialConfig;
    }

    /// @dev Configuration is Safe-only; delayed weakening is handled by a later task.
    function setAssetPolicy(
        address token,
        uint256 basePerTransaction,
        uint256 stepUpPerTransaction,
        uint256 baseDailyLimit,
        uint256 instantDailyLimit,
        address[] calldata recipients
    ) external onlySafe {
        if (
            basePerTransaction == 0 || stepUpPerTransaction == 0 || baseDailyLimit == 0 ||
            instantDailyLimit <= baseDailyLimit || basePerTransaction > baseDailyLimit ||
            stepUpPerTransaction > instantDailyLimit || recipients.length == 0
        ) revert InvalidAssetPolicy();
        assetPolicy[token] = AssetPolicy(basePerTransaction, stepUpPerTransaction, baseDailyLimit, instantDailyLimit);
        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i] == address(0)) revert InvalidAssetPolicy();
            allowedRecipient[token][recipients[i]] = true;
        }
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

        // Preserve Safe's zero-value owner-management calls; every value-bearing
        // transfer and every non-empty call is subject to the fail-closed policy.
        if (value != 0 || data.length != 0) {
            _authorizeTransfer(to, value, data, operation, signatures.length > ownerEnd);
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

    function _authorizeTransfer(address to, uint256 value, bytes calldata data, Enum.Operation operation, bool burnerApproved) internal {
        if (operation != Enum.Operation.Call) revert UnsupportedTransfer();

        address token;
        address recipient;
        uint256 amount;
        if (data.length == 0) {
            token = address(0);
            recipient = to;
            amount = value;
        } else {
            if (value != 0 || data.length != 68 || bytes4(data[:4]) != bytes4(0xa9059cbb)) revert UnsupportedTransfer();
            token = to;
            (recipient, amount) = abi.decode(data[4:], (address, uint256));
        }

        AssetPolicy memory policy = assetPolicy[token];
        if (policy.instantDailyLimit == 0) revert UnsupportedTransfer();
        if (!allowedRecipient[token][recipient]) revert RecipientNotAllowed();
        if (amount == 0) revert UnsupportedTransfer();

        uint256 window = _currentWindow();
        SpendState memory state = spendState[token];
        if (state.window != window) state = SpendState(window, 0, 0);

        AuthorizationTier tier;
        if (!burnerApproved) {
            if (
                amount > policy.basePerTransaction || amount > policy.baseDailyLimit - state.baseSpent ||
                amount > policy.instantDailyLimit - state.instantSpent
            ) revert TransferExceedsLimit();
            tier = AuthorizationTier.Base;
            state.baseSpent += amount;
        } else {
            if (amount > policy.stepUpPerTransaction || amount > policy.instantDailyLimit - state.instantSpent) revert TransferExceedsLimit();
            tier = AuthorizationTier.StepUp;
        }
        state.instantSpent += amount;
        spendState[token] = state;
        emit TransferAuthorized(tier, token, recipient, amount, state.baseSpent, state.instantSpent, window);
    }

    function _currentWindow() internal view returns (uint256) {
        if (block.timestamp < config.periodAnchor) revert InvalidConfig();
        return uint256(config.periodAnchor) + ((block.timestamp - uint256(config.periodAnchor)) / uint256(config.periodSeconds)) * uint256(config.periodSeconds);
    }
}
