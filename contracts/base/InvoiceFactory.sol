// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IInvoice} from "../interfaces/IInvoice.sol";

contract InvoiceFactory is AccessControlUpgradeable, PausableUpgradeable {

    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");

    uint256 public currentInvoiceImplementationVersion;

    struct InvoiceInfo {
        address instance;
        uint256 version;
    }

    mapping(uint256 => address) public invoiceImplementationByVersion;
    mapping(bytes32 => InvoiceInfo) public invoiceDeployed;
    mapping(bytes32 => mapping(uint256 => bool)) public nonceUsed;

    event InvoiceImplementationSet(uint256 indexed version, address invoiceImplementation);
    event InvoiceProcessed(bytes32 indexed orderID, address indexed instance, bool accepted);
    event WithdrawFromInvoice(bytes32 indexed orderID, address indexed instance, address indexed token, uint256 value);

    error InvalidSignature();
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
     * @param invoiceImplementation The address of the starting Invoice implementation contract.
     */
    function initialize(address admin, address validator, address invoiceImplementation) external virtual initializer {
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VALIDATOR_ROLE, validator);
        currentInvoiceImplementationVersion = 1;
        invoiceImplementationByVersion[1] = invoiceImplementation;
        emit InvoiceImplementationSet(1, invoiceImplementation);
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
    function getInvoiceAddress(bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external view virtual returns(address) {
        return Clones.predictDeterministicAddress(invoiceImplementationByVersion[currentInvoiceImplementationVersion], _getSalt(orderID, merchant, customer, token, paymentDeadline, merchantChoiceDeadline));
    }

    /**
     * @notice Predicts the deterministic contract address for an invoice using the current active implementation version.
     * @param version The specific logic implementation version number to check against.
     * @param orderID The unique identifier of the order.
     * @param merchant The address of the merchant.
     * @param customer The address of the customer.
     * @param token The address of the token used for payment.
     * @param paymentDeadline The unix timestamp deadline for the customer to complete payment.
     * @param merchantChoiceDeadline The unix timestamp deadline for the merchant to accept payment.
     * @return The pre-calculated deterministic address of the Invoice clone.
     */
    function getInvoiceAddressWithVersion(uint256 version, bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external view virtual returns(address) {
        return Clones.predictDeterministicAddress(invoiceImplementationByVersion[version], _getSalt(orderID, merchant, customer, token, paymentDeadline, merchantChoiceDeadline));
    }
    
    /**
     * @notice Deploys a minimal proxy clone for an Invoice using CREATE2 and initializes it.
     * @dev Requires contract to not be in paused state.
     * @param orderID The unique identifier of the order.
     * @param merchant The address of the merchant.
     * @param customer The address of the customer.
     * @param token The address of the token used for payment.
     * @param paymentDeadline The unix timestamp deadline for the customer to complete payment.
     * @param merchantChoiceDeadline The unix timestamp deadline for the merchant to accept payment.
     * @param signature The cryptographic signature from the authorized validator.
     */
    function deployAndProcess(bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline, bytes calldata signature) external virtual whenNotPaused {
        bytes32 salt = _getSalt(orderID, merchant, customer, token, paymentDeadline, merchantChoiceDeadline);
        _checkValidatorSignature(MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode(block.chainid, address(this), this.deployAndProcess.selector, salt))), signature);
        if (paymentDeadline >= merchantChoiceDeadline) {
            revert InvalidInput();
        }
        if (invoiceDeployed[orderID].instance != address(0)) {
            revert InvoiceDeployed(orderID);
        }
        address instance = Clones.cloneDeterministic(invoiceImplementationByVersion[currentInvoiceImplementationVersion], salt);
        invoiceDeployed[orderID] = InvoiceInfo(instance, currentInvoiceImplementationVersion);
        emit InvoiceProcessed(orderID, instance, IInvoice(instance).initialize(merchant, customer, token, paymentDeadline, merchantChoiceDeadline));
    }

    /**
     * @notice Executes a token withdrawal from a specific deployed Invoice instance based on a validator's signature.
     * @param orderID The unique identifier of the order.
     * @param nonce A unique number to prevent signature replay attacks.
     * @param tokenToWithdraw The address of the token to extract.
     * @param valueToWithdraw The exact amount of token to withdraw.
     * @param signature The cryptographic signature from the authorized validator.
     */
    function withdrawFromInvoice(bytes32 orderID, uint256 nonce, address tokenToWithdraw, uint256 valueToWithdraw, bytes calldata signature) external virtual {
        address instance = invoiceDeployed[orderID].instance;
        if (instance == address(0)) {
            revert InvoiceNotDeployed(orderID);
        }
        _checkValidatorSignature(MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode(block.chainid, address(this), this.withdrawFromInvoice.selector, orderID, nonce, tokenToWithdraw, valueToWithdraw))), signature);
        if (nonceUsed[orderID][nonce]) {
            revert NonceUsed();
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
        emit InvoiceImplementationSet(currentInvoiceImplementationVersion, invoiceImplementation);
    }

    /**
     * @notice Pauses the contract, preventing any new Invoice deployments via `deployAndProcess`.
     * @dev Restricted to accounts holding the `DEFAULT_ADMIN_ROLE`.
     */
    function pause() external virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpauses the contract, allowing Invoice deployments via `deployAndProcess` to resume.
     * @dev Restricted to accounts holding the `DEFAULT_ADMIN_ROLE`.
     */
    function unpause() external virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function _getSalt(bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) internal pure virtual returns(bytes32) {
        return keccak256(abi.encode(orderID, merchant, customer, token, paymentDeadline, merchantChoiceDeadline));
    }

    function _checkValidatorSignature(bytes32 hash, bytes calldata signature) internal virtual {
        if (!hasRole(VALIDATOR_ROLE, ECDSA.recoverCalldata(hash, signature))) {
            revert InvalidSignature();
        }
    }
}