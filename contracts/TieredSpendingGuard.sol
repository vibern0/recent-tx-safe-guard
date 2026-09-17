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

interface IDelayPolicy {
    function txCooldown() external view returns (uint256);
    function txExpiration() external view returns (uint256);
}

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
    bytes4 private constant DELAY_QUEUE_SELECTOR = 0x468721a7; // execTransactionFromModule(address,uint256,bytes,uint8)
    bytes4 private constant DELAY_SET_NONCE_SELECTOR = 0x46ba2307; // setTxNonce(uint256)
    bytes4 private constant FREEZE_SELECTOR = bytes4(keccak256("freeze()"));
    bytes4 private constant REPLACE_GUARDS_SELECTOR = 0x7ec60d4f;
    bytes4 private constant REPLACE_SIGNER_SELECTOR = bytes4(keccak256("replaceSigner(address,uint8,address,address,address,uint256)"));
    bytes4 private constant REPAIR_SIGNER_SELECTOR = bytes4(keccak256("repairSigner(uint8,address,address)"));
    bytes4 private constant REPAIR_POLICY_SELECTOR = bytes4(keccak256("repairPolicy(address,uint256,uint256,uint256,uint256,address[])"));
    bytes4 private constant SET_ASSET_POLICY_SELECTOR = bytes4(keccak256("setAssetPolicy(address,uint256,uint256,uint256,uint256,address[])"));

    GuardConfig public config;
    mapping(address => AssetPolicy) public assetPolicy;
    mapping(address => SpendState) public spendState;
    mapping(address => mapping(address => bool)) public allowedRecipient;
    mapping(address => address[]) private policyRecipients;
    mapping(bytes32 => bool) public burnerAuthorizationUsed;
    bool private checking;
    address private pendingToken;
    address private pendingRecipient;
    uint256 private pendingAmount;
    uint256 private pendingSafeBalance;
    uint256 private pendingRecipientBalance;
    bool private pendingTokenProof;
    address public maintenance;
    bool public frozen;

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
    error InvalidDelayedAction();
    error Frozen();
    error MaintenanceAlreadySet();
    error InvalidRepair();

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
        AssetPolicy memory previous = assetPolicy[token];
        if (previous.instantDailyLimit != 0) {
            if (basePerTransaction > previous.basePerTransaction || stepUpPerTransaction > previous.stepUpPerTransaction || baseDailyLimit > previous.baseDailyLimit || instantDailyLimit > previous.instantDailyLimit) revert InvalidAssetPolicy();
            for (uint256 i; i < recipients.length; ++i) {
                if (!allowedRecipient[token][recipients[i]]) revert InvalidAssetPolicy();
            }
        }
        assetPolicy[token] = AssetPolicy(basePerTransaction, stepUpPerTransaction, baseDailyLimit, instantDailyLimit);
        address[] storage previousRecipients = policyRecipients[token];
        for (uint256 i; i < previousRecipients.length; ++i) {
            allowedRecipient[token][previousRecipients[i]] = false;
        }
        delete policyRecipients[token];
        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i] == address(0)) revert InvalidAssetPolicy();
            allowedRecipient[token][recipients[i]] = true;
            policyRecipients[token].push(recipients[i]);
        }
    }

    function setMaintenance(address replacementMaintenance) external onlySafe {
        if (maintenance != address(0) || replacementMaintenance == address(0)) revert MaintenanceAlreadySet();
        maintenance = replacementMaintenance;
    }

    function freeze() external onlySafe {
        frozen = true;
    }

    function repairSigner(uint8 role, address expectedOld, address replacement) external onlySafe {
        if (replacement == address(0) || expectedOld == address(0) || replacement == config.passkey || replacement == config.burner || replacement == config.recovery || role > 2) revert InvalidRepair();
        address current = role == 0 ? config.passkey : role == 1 ? config.burner : config.recovery;
        if (current != expectedOld) revert InvalidRepair();
        if (role == 0) config.passkey = replacement;
        else if (role == 1) config.burner = replacement;
        else config.recovery = replacement;
    }

    function repairPolicy(address token, uint256 basePerTx, uint256 stepUpPerTx, uint256 baseDaily, uint256 instantDaily, address[] calldata recipients) external onlySafe {
        if (token == address(0) || recipients.length == 0) revert InvalidRepair();
        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i] == address(0)) revert InvalidRepair();
            for (uint256 j; j < i; ++j) if (recipients[i] == recipients[j]) revert InvalidRepair();
        }
        AssetPolicy memory current = assetPolicy[token];
        if (current.instantDailyLimit != 0 && (basePerTx > current.basePerTransaction || stepUpPerTx > current.stepUpPerTransaction || baseDaily > current.baseDailyLimit || instantDaily > current.instantDailyLimit)) revert InvalidRepair();
        _setAssetPolicy(token, basePerTx, stepUpPerTx, baseDaily, instantDaily, recipients);
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
        (signer, ownerEnd,) = SafeSignatureDecoder.decode(signatures, bytes32(0), false);
        SafeSignatureDecoder.requireNoTrailingData(signatures, ownerEnd);
    }

    function decodeBurnerExtension(bytes calldata signatures) external view returns (bytes calldata burnerSignature) {
        (, uint256 ownerEnd,) = SafeSignatureDecoder.decode(signatures, bytes32(0), false);
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
        bool recoveryAction = _isRecoveryAction(to, value, data, operation);
        bool emergencyAction = _isEmergencyAction(to, value, data, operation);
        (, uint256 ownerEnd, bool isContractSignature) = SafeSignatureDecoder.decode(signatures, txHash, recoveryAction);
        (address passkeySigner,,) = SafeSignatureDecoder.decode(signatures, txHash, recoveryAction);
        if (recoveryAction && !emergencyAction) {
            if (passkeySigner != config.recovery) revert InvalidPasskeySignature();
        } else if (emergencyAction) {
            if (passkeySigner != config.passkey && passkeySigner != config.recovery) revert InvalidPasskeySignature();
        } else if (passkeySigner != config.passkey || !isContractSignature) revert InvalidPasskeySignature();
        if (passkeySigner == config.passkey && !isContractSignature) revert InvalidPasskeySignature();
        try ISafe(payable(config.safe)).checkNSignatures(executor, txHash, signatures, 1) {} catch { revert InvalidPasskeySignature(); }

        if (signatures.length > ownerEnd) {
            if (recoveryAction && !emergencyAction) revert InvalidDelayedAction();
            bytes calldata burnerSignature = _burnerExtension(signatures, ownerEnd);
            if (!SignatureChecker.isValidSignatureNow(config.burner, txHash, burnerSignature)) revert InvalidBurnerSignature();
            bytes32 authorization = keccak256(abi.encode(txHash, keccak256(burnerSignature)));
            if (burnerAuthorizationUsed[authorization]) revert InvalidBurnerSignature();
            burnerAuthorizationUsed[authorization] = true;
        }

        if (recoveryAction) {
            if (emergencyAction && passkeySigner == config.passkey && signatures.length == ownerEnd) revert MissingBurnerExtension();
            _authorizeRecovery(to, value, data, operation);
        } else if (_isImmediateDelayTightening(to, value, data, operation)) {
            if (signatures.length > ownerEnd) revert InvalidDelayedAction();
        } else if (_isExactSetAssetPolicy(data) && to == address(this) && value == 0 && operation == Enum.Operation.Call) {
            revert InvalidPasskeySignature();
        } else if (_isQueueProposal(to, value, data, operation)) {
            _authorizeQueueProposal(data, signatures.length > ownerEnd, recoveryAction);
        } else {
            _authorizeTransfer(to, value, data, operation, signatures.length > ownerEnd);
        }
    }

    function checkAfterExecution(bytes32, bool success) external override onlySafe {
        if (!checking) revert NoPendingCheck();
        if (!success) revert ExecutionFailed();
        if (pendingTokenProof) {
            uint256 safeBalance = _readBalance(pendingToken, config.safe);
            uint256 recipientBalance = _readBalance(pendingToken, pendingRecipient);
            if (
                safeBalance + pendingAmount != pendingSafeBalance ||
                recipientBalance != pendingRecipientBalance + pendingAmount
            ) revert ExecutionFailed();
        }
        _clearPendingTransfer();
        checking = false;
    }

    function checkModuleTransaction(address to, uint256 value, bytes calldata data, Enum.Operation operation, address module)
        external override onlySafe returns (bytes32 moduleTxHash)
    {
        if (checking) revert ReentrantCheck();
        if (module != config.delay || module == address(0)) revert InvalidConfig();
        checking = true;
        if (operation == Enum.Operation.DelegateCall) {
            if (!_isMaintenanceAction(to, data)) revert InvalidDelayedAction();
        } else {
            _authorizeDelayedExecution(to, value, data, operation);
        }
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
        if (frozen) revert Frozen();
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
        if (token != address(0)) {
            pendingToken = token;
            pendingRecipient = recipient;
            pendingAmount = amount;
            pendingSafeBalance = _readBalance(token, config.safe);
            pendingRecipientBalance = _readBalance(token, recipient);
            pendingTokenProof = true;
        }
        emit TransferAuthorized(tier, token, recipient, amount, state.baseSpent, state.instantSpent, window);
    }

    function _isQueueProposal(address to, uint256 value, bytes calldata data, Enum.Operation operation) internal view returns (bool) {
        return to == config.delay && value == 0 && operation == Enum.Operation.Call && data.length >= 4 && bytes4(data[:4]) == DELAY_QUEUE_SELECTOR;
    }

    function _authorizeQueueProposal(bytes calldata data, bool burnerApproved, bool recoveryApproved) internal view {
        if (data.length < 4 + 32 * 4) revert InvalidDelayedAction();
        (address target, uint256 value, bytes memory innerData, uint8 operation) = abi.decode(data[4:], (address, uint256, bytes, uint8));
        if (keccak256(data) != keccak256(abi.encodeWithSelector(DELAY_QUEUE_SELECTOR, target, value, innerData, operation))) revert InvalidDelayedAction();
        if (operation == uint8(Enum.Operation.DelegateCall)) {
            if (!_isMaintenanceAction(target, innerData) || (!burnerApproved && !recoveryApproved)) revert InvalidDelayedAction();
            return;
        }
        if (operation != uint8(Enum.Operation.Call)) revert InvalidDelayedAction();
        if (target == address(this)) {
            if (!_isExactRepair(innerData) || (!recoveryApproved && !burnerApproved)) revert InvalidRepair();
            return;
        }
        if (!burnerApproved) revert MissingBurnerExtension();
        (address token, address recipient, uint256 amount) = _decodeTransfer(target, value, innerData);
        AssetPolicy memory policy = assetPolicy[token];
        SpendState memory state = spendState[token];
        uint256 window = _currentWindow();
        uint256 spent = state.window == window ? state.instantSpent : 0;
        if (policy.instantDailyLimit == 0 || amount <= policy.instantDailyLimit - spent || !allowedRecipient[token][recipient]) revert InvalidDelayedAction();
    }

    function _authorizeDelayedExecution(address to, uint256 value, bytes calldata data, Enum.Operation operation) internal view {
        if (operation == Enum.Operation.DelegateCall) {
            if (!_isMaintenanceAction(to, data)) revert InvalidDelayedAction();
            return;
        }
        if (frozen || operation != Enum.Operation.Call) revert InvalidDelayedAction();
        if (to == address(this)) {
            if (!_isExactRepair(data)) revert InvalidRepair();
            return;
        }
        (address token, address recipient, uint256 amount) = _decodeTransfer(to, value, data);
        if (assetPolicy[token].instantDailyLimit == 0 || !allowedRecipient[token][recipient] || amount == 0) revert InvalidDelayedAction();
    }

    function _decodeTransfer(address to, uint256 value, bytes memory data) internal pure returns (address token, address recipient, uint256 amount) {
        if (data.length == 0) return (address(0), to, value);
        if (value != 0 || data.length != 68 || bytes4(data) != bytes4(0xa9059cbb)) revert InvalidDelayedAction();
        bytes memory args = new bytes(data.length - 4);
        for (uint256 i; i < args.length; ++i) args[i] = data[i + 4];
        (recipient, amount) = abi.decode(args, (address, uint256));
        return (to, recipient, amount);
    }

    function _isRecoveryAction(address to, uint256 value, bytes calldata data, Enum.Operation operation) internal view returns (bool) {
        if (value != 0 || operation != Enum.Operation.Call) return false;
        if (to == address(this) && data.length == 4 && bytes4(data[:4]) == FREEZE_SELECTOR) return true;
        if (to == address(this) && _isExactSetAssetPolicy(data)) return true;
        if (to == config.delay && data.length == 36 && bytes4(data[:4]) == DELAY_SET_NONCE_SELECTOR) return true;
        return _isQueueProposal(to, value, data, operation) && _queueContainsRepair(data);
    }

    function _isEmergencyAction(address to, uint256 value, bytes calldata data, Enum.Operation operation) internal view returns (bool) {
        if (value != 0 || operation != Enum.Operation.Call) return false;
        return (to == address(this) && data.length == 4 && bytes4(data[:4]) == FREEZE_SELECTOR) ||
            (to == config.delay && data.length == 36 && bytes4(data[:4]) == DELAY_SET_NONCE_SELECTOR);
    }

    function _queueContainsRepair(bytes calldata data) internal view returns (bool) {
        (address target, , bytes memory innerData, uint8 operation) = abi.decode(data[4:], (address, uint256, bytes, uint8));
        return (operation == uint8(Enum.Operation.Call) && _isExactRepair(innerData)) ||
            (operation == uint8(Enum.Operation.DelegateCall) && _isMaintenanceAction(target, innerData));
    }

    function _isExactRepair(bytes memory data) internal pure returns (bool) {
        if (data.length < 4) return false;
        if (bytes4(data) == REPAIR_SIGNER_SELECTOR) {
            if (data.length != 100) return false;
            (uint8 role, address expectedOld, address replacement) = abi.decode(_copy(data, 4), (uint8, address, address));
            return keccak256(data) == keccak256(abi.encodeWithSelector(REPAIR_SIGNER_SELECTOR, role, expectedOld, replacement));
        }
        if (bytes4(data) == REPAIR_POLICY_SELECTOR) {
            if (data.length < 4 + 32 * 6) return false;
            (address token, uint256 a, uint256 b, uint256 c, uint256 d, address[] memory recipients) = abi.decode(_copy(data, 4), (address, uint256, uint256, uint256, uint256, address[]));
            return keccak256(data) == keccak256(abi.encodeWithSelector(REPAIR_POLICY_SELECTOR, token, a, b, c, d, recipients));
        }
        return false;
    }

    function _isMaintenanceAction(address target, bytes memory data) internal view returns (bool) {
        if (maintenance == address(0) || target != maintenance || data.length < 4) return false;
        bytes4 selector = bytes4(data);
        if (selector == REPLACE_GUARDS_SELECTOR) return data.length == 68;
        if (selector == REPLACE_SIGNER_SELECTOR) return data.length == 196;
        return false;
    }

    function _isImmediateDelayTightening(address to, uint256 value, bytes calldata data, Enum.Operation operation) internal view returns (bool) {
        if (to != config.delay || value != 0 || operation != Enum.Operation.Call || data.length != 36) return false;
        bytes4 selector = bytes4(data[:4]);
        uint256 next = uint256(bytes32(data[4:36]));
        if (selector == bytes4(keccak256("setTxCooldown(uint256)"))) return next >= IDelayPolicy(config.delay).txCooldown();
        if (selector == bytes4(keccak256("setTxExpiration(uint256)"))) {
            uint256 current = IDelayPolicy(config.delay).txExpiration();
            return current == 0 || (next != 0 && next <= current);
        }
        return false;
    }

    function _copy(bytes memory input, uint256 start) internal pure returns (bytes memory output) {
        output = new bytes(input.length - start);
        for (uint256 i; i < output.length; ++i) output[i] = input[i + start];
    }

    function _setAssetPolicy(address token, uint256 basePerTransaction, uint256 stepUpPerTransaction, uint256 baseDailyLimit, uint256 instantDailyLimit, address[] calldata recipients) internal {
        if (basePerTransaction == 0 || stepUpPerTransaction == 0 || baseDailyLimit == 0 || instantDailyLimit <= baseDailyLimit || basePerTransaction > baseDailyLimit || stepUpPerTransaction > instantDailyLimit) revert InvalidAssetPolicy();
        assetPolicy[token] = AssetPolicy(basePerTransaction, stepUpPerTransaction, baseDailyLimit, instantDailyLimit);
        address[] storage previousRecipients = policyRecipients[token];
        for (uint256 i; i < previousRecipients.length; ++i) allowedRecipient[token][previousRecipients[i]] = false;
        delete policyRecipients[token];
        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i] == address(0)) revert InvalidAssetPolicy();
            allowedRecipient[token][recipients[i]] = true;
            policyRecipients[token].push(recipients[i]);
        }
    }

    function _authorizeRecovery(address to, uint256 value, bytes calldata data, Enum.Operation operation) internal view {
        if (!_isRecoveryAction(to, value, data, operation)) revert InvalidDelayedAction();
    }

    function _isExactSetAssetPolicy(bytes calldata data) internal pure returns (bool) {
        if (data.length < 4 + 32 * 6 || bytes4(data[:4]) != SET_ASSET_POLICY_SELECTOR) return false;
        (address token, uint256 a, uint256 b, uint256 c, uint256 d, address[] memory recipients) = abi.decode(data[4:], (address, uint256, uint256, uint256, uint256, address[]));
        return keccak256(data) == keccak256(abi.encodeWithSelector(SET_ASSET_POLICY_SELECTOR, token, a, b, c, d, recipients));
    }

    function _readBalance(address token, address account) internal view returns (uint256 balance) {
        (bool success, bytes memory returndata) = token.staticcall(abi.encodeWithSelector(0x70a08231, account));
        if (!success || returndata.length != 32) revert UnsupportedTransfer();
        balance = abi.decode(returndata, (uint256));
    }

    function _clearPendingTransfer() internal {
        pendingToken = address(0);
        pendingRecipient = address(0);
        pendingAmount = 0;
        pendingSafeBalance = 0;
        pendingRecipientBalance = 0;
        pendingTokenProof = false;
    }

    function _currentWindow() internal view returns (uint256) {
        if (block.timestamp < config.periodAnchor) revert InvalidConfig();
        return uint256(config.periodAnchor) + ((block.timestamp - uint256(config.periodAnchor)) / uint256(config.periodSeconds)) * uint256(config.periodSeconds);
    }
}
