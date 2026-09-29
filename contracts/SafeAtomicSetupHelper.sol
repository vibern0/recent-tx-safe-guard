// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

interface ISafeAtomicSelfSetup {
    function setGuard(address guard) external;
    function setModuleGuard(address guard) external;
    function enableModule(address module) external;
    function isModuleEnabled(address module) external view returns (bool);
}

interface IAtomicGuardSetup {
    function config() external view returns (address safe, address passkey, address burner, address delay, uint64 periodSeconds, uint64 periodAnchor);
    function setAssetPolicy(
        address token,
        uint256 basePerTransaction,
        uint256 stepUpPerTransaction,
        uint256 baseDailyLimit,
        uint256 instantDailyLimit,
        address[] calldata recipients
    ) external;
    function setMaintenance(address replacementMaintenance) external;
    function maintenance() external view returns (address);
}

interface IAtomicDelaySetup {
    function owner() external view returns (address);
    function avatar() external view returns (address);
    function target() external view returns (address);
    function enableModule(address module) external;
    function isModuleEnabled(address module) external view returns (bool);
}

/// @notice Safe setup delegatecall helper for the two-owner atomic vault.
/// @dev This contract is intentionally stateless. Safe setup executes it by
///      delegatecall, making `address(this)` the final Safe proxy address.
contract SafeAtomicSetupHelper {
    struct AssetPolicyInit {
        address token;
        uint256 basePerTransaction;
        uint256 stepUpPerTransaction;
        uint256 baseDailyLimit;
        uint256 instantDailyLimit;
        address[] recipients;
    }

    struct SetupParams {
        address guard;
        address delay;
        address maintenance;
        address passkey;
        address burner;
        uint64 periodSeconds;
        uint64 periodAnchor;
        AssetPolicyInit[] assets;
    }

    error MissingCode(address target);
    error InvalidBinding();
    error SetupCallFailed(bytes4 selector);

    bytes4 private constant SET_ASSET_POLICY_SELECTOR = IAtomicGuardSetup.setAssetPolicy.selector;
    bytes4 private constant SET_MAINTENANCE_SELECTOR = IAtomicGuardSetup.setMaintenance.selector;
    bytes4 private constant DELAY_ENABLE_MODULE_SELECTOR = IAtomicDelaySetup.enableModule.selector;
    bytes4 private constant SAFE_SET_GUARD_SELECTOR = ISafeAtomicSelfSetup.setGuard.selector;
    bytes4 private constant SAFE_SET_MODULE_GUARD_SELECTOR = ISafeAtomicSelfSetup.setModuleGuard.selector;
    bytes4 private constant SAFE_ENABLE_MODULE_SELECTOR = ISafeAtomicSelfSetup.enableModule.selector;

    /// @notice Configures guard, Delay, maintenance, and asset policy during Safe setup.
    /// @dev Must be called only through Safe `setup` delegatecall. Direct calls use the
    ///      helper address as `address(this)` and fail the component binding checks.
    function setup(SetupParams calldata params) external {
        address safe = address(this);
        _requireCode(params.guard);
        _requireCode(params.delay);
        _requireCode(params.maintenance);

        (address configuredSafe, address configuredPasskey, address configuredBurner, address configuredDelay, uint64 configuredPeriodSeconds, uint64 configuredPeriodAnchor) =
            IAtomicGuardSetup(params.guard).config();
        if (
            configuredSafe != safe ||
            configuredPasskey != params.passkey ||
            configuredBurner != params.burner ||
            configuredDelay != params.delay ||
            configuredPeriodSeconds != params.periodSeconds ||
            configuredPeriodAnchor != params.periodAnchor
        ) revert InvalidBinding();
        if (
            IAtomicDelaySetup(params.delay).owner() != safe ||
            IAtomicDelaySetup(params.delay).avatar() != safe ||
            IAtomicDelaySetup(params.delay).target() != safe
        ) revert InvalidBinding();

        for (uint256 i; i < params.assets.length; ++i) {
            AssetPolicyInit calldata asset = params.assets[i];
            _checkedCall(
                params.guard,
                abi.encodeWithSelector(
                    SET_ASSET_POLICY_SELECTOR,
                    asset.token,
                    asset.basePerTransaction,
                    asset.stepUpPerTransaction,
                    asset.baseDailyLimit,
                    asset.instantDailyLimit,
                    asset.recipients
                ),
                SET_ASSET_POLICY_SELECTOR
            );
        }

        _checkedCall(params.guard, abi.encodeWithSelector(SET_MAINTENANCE_SELECTOR, params.maintenance), SET_MAINTENANCE_SELECTOR);
        _checkedCall(params.delay, abi.encodeWithSelector(DELAY_ENABLE_MODULE_SELECTOR, safe), DELAY_ENABLE_MODULE_SELECTOR);
        _checkedCall(safe, abi.encodeWithSelector(SAFE_SET_GUARD_SELECTOR, params.guard), SAFE_SET_GUARD_SELECTOR);
        _checkedCall(safe, abi.encodeWithSelector(SAFE_SET_MODULE_GUARD_SELECTOR, params.guard), SAFE_SET_MODULE_GUARD_SELECTOR);
        _checkedCall(safe, abi.encodeWithSelector(SAFE_ENABLE_MODULE_SELECTOR, params.delay), SAFE_ENABLE_MODULE_SELECTOR);

        if (
            IAtomicGuardSetup(params.guard).maintenance() != params.maintenance ||
            !IAtomicDelaySetup(params.delay).isModuleEnabled(safe) ||
            !ISafeAtomicSelfSetup(safe).isModuleEnabled(params.delay)
        ) revert InvalidBinding();
    }

    function _requireCode(address target) private view {
        if (target.code.length == 0) revert MissingCode(target);
    }

    function _checkedCall(address target, bytes memory data, bytes4 selector) private {
        (bool ok,) = target.call(data);
        if (!ok) revert SetupCallFailed(selector);
    }
}
