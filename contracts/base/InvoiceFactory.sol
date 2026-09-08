// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IInvoice} from "../interfaces/IInvoice.sol";

contract InvoiceFactory is AccessControlUpgradeable, PausableUpgradeable {

    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");

    uint256 public currentInvoiceImplementationVersion;
    uint256 public minSignatures;

    struct InvoiceInfo {
        address instance;
        uint256 version;
    }

    struct MetaInfo {
        uint256 chainId;
        address contractAddress;
        bytes4 selector;
    }

    struct OrderInfo {
        uint256 value;
        uint256 signaturesDeadline;
        address invoiceImplementation;
    }

    mapping(uint256 => address) public invoiceImplementationByVersion;
    mapping(address => uint256) public versionByInvoiceImplementation;
    mapping(bytes32 => InvoiceInfo) public invoiceDeployed;
    mapping(bytes32 => mapping(uint256 => bool)) public nonceUsed;

    uint256[44] private __gap;

    event InvoiceImplementationSet(uint256 indexed version, address invoiceImplementation);
    event MinSignaturesSet(uint256 minSignatures);
    event InvoiceProcessed(bytes32 indexed orderID, address indexed instance, address indexed token, uint256 value, bool accepted);
    event WithdrawFromInvoice(bytes32 indexed orderID, address indexed instance, address indexed token, uint256 value);

    error InvalidSignaturesCount(uint256 minSignatures, uint256 signersLength);
    error SignaturesDeadlinePassed(uint256 signaturesDeadline, uint256 currentTime);
    error InvalidInput();
    error InvoiceDeployed(bytes32 orderID);
    error InvoiceNotDeployed(bytes32 orderID);
    error NonceUsed();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the factory state, configures base roles, and sets up the primary Invoice tracking version.
     * @param admin The address granted `DEFAULT_ADMIN_ROLE` for administrative tasks and upgrades.
     * @param validator The system address granted `VALIDATOR_ROLE` to sign order operational messages.
     * @param pauser The address granted `PAUSER_ROLE`.
     * @param unpauser The address granted `UNPAUSER_ROLE`.
     * @param invoiceImplementation The address of the starting Invoice implementation contract.
     * @param _minSignatures Initial value of `minSignatures` parameter, which defines how many validator signatures are needed for invoice processing and withdrawals.
     */
    function initialize(address admin, address validator, address pauser, address unpauser, address invoiceImplementation, uint256 _minSignatures) external virtual initializer {
        if (_minSignatures == 0) {
            revert InvalidInput();
        }
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VALIDATOR_ROLE, validator);
        _grantRole(PAUSER_ROLE, pauser);
        _grantRole(UNPAUSER_ROLE, unpauser);
        currentInvoiceImplementationVersion = 1;
        invoiceImplementationByVersion[1] = invoiceImplementation;
        versionByInvoiceImplementation[invoiceImplementation] = 1;
        minSignatures = _minSignatures;
        emit InvoiceImplementationSet(1, invoiceImplementation);
        emit MinSignaturesSet(_minSignatures);
    }

    /**
     * @notice Predicts the deterministic contract address for an invoice using the current active implementation version.
     * @param orderID The unique identifier of the order.
     * @param merchant The address of the merchant.
     * @param customer The address of the customer.
     * @param token The address of the token used for payment.
     * @param paymentDeadline The unix timestamp deadline for the customer to complete payment.
     * @param merchantChoiceDeadline The unix timestamp deadline for the merchant to accept payment.
     * @return The pre-calculated deterministic address of the Invoice clone.
     */
    function getInvoiceAddress(bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external view virtual returns(address) {}

    /**
     * @notice Predicts the deterministic contract address for an invoice using the specified implementation version.
     * @param version The specific logic implementation version number to check against.
     * @param orderID The unique identifier of the order.
     * @param merchant The address of the merchant.
     * @param customer The address of the customer.
     * @param token The address of the token used for payment.
     * @param paymentDeadline The unix timestamp deadline for the customer to complete payment.
     * @param merchantChoiceDeadline The unix timestamp deadline for the merchant to accept payment.
     * @return The pre-calculated deterministic address of the Invoice clone.
     */
    function getInvoiceAddressWithVersion(uint256 version, bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external view virtual returns(address) {}

    /**
     * @notice Deploys a minimal proxy clone for an Invoice using CREATE2 and initializes it.
     * @dev Requires contract to not be in paused state.
     * @param orderID The unique identifier of the order.
     * @param merchant The address of the merchant.
     * @param customer The address of the customer.
     * @param token The address of the token used for payment.
     * @param paymentDeadline The unix timestamp deadline for the customer to complete payment.
     * @param merchantChoiceDeadline The unix timestamp deadline for the merchant to accept payment.
     * @param orderInfo Additional information about order which is not included in salt generation.
     * @param signatures The cryptographic signatures array from authorized validators.
     */
    function deployAndProcess(bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline, OrderInfo calldata orderInfo, bytes[] calldata signatures) external virtual whenNotPaused {
        if (block.timestamp > orderInfo.signaturesDeadline) {
            revert SignaturesDeadlinePassed(orderInfo.signaturesDeadline, block.timestamp);
        }
        if (paymentDeadline >= merchantChoiceDeadline) {
            revert InvalidInput();
        }
        if (invoiceDeployed[orderID].instance != address(0)) {
            revert InvoiceDeployed(orderID);
        }
        bytes32 salt = _getSalt(orderID, merchant, customer, token, paymentDeadline, merchantChoiceDeadline);
        _checkValidatorSignatures(MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode(_getMetaInfo(false), salt, orderInfo))), signatures);
        _processInvoice(orderInfo.invoiceImplementation, orderID, merchant, customer, token, orderInfo.value, paymentDeadline, merchantChoiceDeadline, salt);
    }

    /**
     * @notice Executes a token withdrawal from a specific deployed Invoice instance based on a validator signatures.
     * @param orderID The unique identifier of the order.
     * @param nonce A unique number to prevent signature replay attacks.
     * @param tokenToWithdraw The address of the token to withdraw.
     * @param valueToWithdraw The exact amount of token to withdraw.
     * @param signaturesDeadline Unix timestamp after which signatures are considered expired.
     * @param signatures The cryptographic signatures array from authorized validators.
     */
    function withdrawFromInvoice(bytes32 orderID, uint256 nonce, address tokenToWithdraw, uint256 valueToWithdraw, uint256 signaturesDeadline, bytes[] calldata signatures) external virtual {
        if (block.timestamp > signaturesDeadline) {
            revert SignaturesDeadlinePassed(signaturesDeadline, block.timestamp);
        }
        if (nonceUsed[orderID][nonce]) {
            revert NonceUsed();
        }
        _checkValidatorSignatures(MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode(_getMetaInfo(true), orderID, nonce, tokenToWithdraw, valueToWithdraw, signaturesDeadline))), signatures);
        address instance = invoiceDeployed[orderID].instance;
        if (instance == address(0)) {
            revert InvoiceNotDeployed(orderID);
        }
        nonceUsed[orderID][nonce] = true;
        IInvoice(instance).withdraw(tokenToWithdraw, valueToWithdraw);
        emit WithdrawFromInvoice(orderID, instance, tokenToWithdraw, valueToWithdraw);
    }

    /**
     * @notice Upgrades the active Invoice implementation by setting a new implementation address and incrementing the version.
     * @dev Restricted to addresses holding the `DEFAULT_ADMIN_ROLE`.
     * @param invoiceImplementation The address of the new Invoice implementation contract.
     */
    function setInvoiceImplementation(address invoiceImplementation) external virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        invoiceImplementationByVersion[++currentInvoiceImplementationVersion] = invoiceImplementation;
        versionByInvoiceImplementation[invoiceImplementation] = currentInvoiceImplementationVersion;
        emit InvoiceImplementationSet(currentInvoiceImplementationVersion, invoiceImplementation);
    }

    /**
     * @notice Sets `minSignatures` parameter, which defines how many validator signatures are needed for invoice processing and withdrawals.
     * @dev Restricted to addresses holding the `DEFAULT_ADMIN_ROLE`. `minSignatures` cannot be zero.
     * @param _minSignatures New `minSignatures` value.
     */
    function setMinSignatures(uint256 _minSignatures) external virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_minSignatures == 0) {
            revert InvalidInput();
        }
        minSignatures = _minSignatures;
        emit MinSignaturesSet(_minSignatures);
    }

    /**
     * @notice Pauses the contract, preventing any new Invoice deployments via `deployAndProcess`.
     * @dev Restricted to addresses holding the `PAUSER_ROLE`.
     */
    function pause() external virtual onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @notice Unpauses the contract, allowing Invoice deployments via `deployAndProcess` to resume.
     * @dev Restricted to addresses holding the `UNPAUSER_ROLE`.
     */
    function unpause() external virtual onlyRole(UNPAUSER_ROLE) {
        _unpause();
    }

    function _getSalt(bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) internal pure virtual returns(bytes32) {
        return keccak256(abi.encode(orderID, merchant, customer, token, paymentDeadline, merchantChoiceDeadline));
    }

    function _getMetaInfo(bool isWithdraw) internal view virtual returns(MetaInfo memory) {
        return MetaInfo(block.chainid, address(this), isWithdraw ? this.withdrawFromInvoice.selector : this.deployAndProcess.selector);
    }

    function _checkValidatorSignatures(bytes32 hash, bytes[] calldata signatures) internal virtual {
        if (minSignatures > signatures.length) {
            revert InvalidSignaturesCount(minSignatures, signatures.length);
        }
        address[] memory signers = new address[](minSignatures);
        uint256 signersLength;
        for (uint256 i; i < signatures.length; i++) {
            address signerAddress = ECDSA.recoverCalldata(hash, signatures[i]);
            if (hasRole(VALIDATOR_ROLE, signerAddress)) {
                bool duplicateFlag;
                for (uint256 j; j < signersLength; j++) {
                    if (signers[j] == signerAddress) {
                        duplicateFlag = true;
                        break;
                    }
                }
                if (!duplicateFlag) {
                    signers[signersLength++] = signerAddress;
                }
            }
            if (signersLength == minSignatures) {
                break;
            }
        }
        if (signersLength < minSignatures) {
            revert InvalidSignaturesCount(minSignatures, signersLength);
        }
    }

    function _processInvoice(address invoiceImplementation, bytes32 orderID, address merchant, address customer, address token, uint256 value, uint256 paymentDeadline, uint256 merchantChoiceDeadline, bytes32 salt) internal virtual {
        uint256 version = versionByInvoiceImplementation[invoiceImplementation];
        if (version == 0) {
            revert InvalidInput();
        }
        address instance = _cloneDeterministic(invoiceImplementation, salt);
        invoiceDeployed[orderID] = InvoiceInfo(instance, version);
        bool accepted = IInvoice(instance).initialize(merchant, customer, token, value, paymentDeadline, merchantChoiceDeadline);
        emit InvoiceProcessed(orderID, instance, token, value, accepted);
    }

    function _cloneDeterministic(address implementation, bytes32 salt) internal virtual returns(address) {}
}