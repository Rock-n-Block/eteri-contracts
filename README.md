# eteri-contracts

## Smart Contract Description

### Invoice

Inherits from OwnableUpgradeable.

Network-specific implementations inherit from Invoice and modify behavior, for example, the EVM implementation supports SafeERC20.

#### Variables

`address public constant MOCK_NATIVE_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;` - Mock address of the native currency.

`address public customer;` - Customer address, set in initialize.

#### Functions

`function initialize(address merchant, address _customer, IERC20 token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external virtual initializer returns(bool)` - Called once during creation. Transfers the entire token balance to _customer if the current time is greater than merchantChoiceDeadline, transfers the entire token balance to merchant if the previous condition is not met and the current time is greater than paymentDeadline.

`function withdraw(IERC20 token, uint256 value) external virtual onlyOwner` - Allows transferring an arbitrary token to customer in an arbitrary amount. Controlled by InvoiceFactory.

#### Events

`event Accept();` - Occurs if the token in initialize is transferred to merchant.

`event Refund();` - Occurs if the token in initialize is transferred to customer.

`event Withdraw(IERC20 indexed token, uint256 value);` - Occurs upon calling withdraw.

#### Errors

`error PaymentDeadlineNotPassed(uint256 paymentDeadline, uint256 currentTimestamp);` - Occurs in initialize if none of the conditions for successful completion of the function are met.

`error NativeTransferFailed(address receiver, bytes returnData);` - Occurs upon any unsuccessful transfer of native currency, returnData - returned data of the unsuccessful call with the transfer.

---

### InvoiceFactory

Inherits from AccessControlUpgradeable, PausableUpgradeable.

Network-specific implementations inherit from InvoiceFactory.

#### Variables

`bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");` - Validator role identifier.

`uint256 public currentInvoiceImplementationVersion;` - Current Invoice implementation version number. Starts at 1.

```solidity
struct InvoiceInfo { - Struct containing created Invoice information.
    address instance; - Address.
    uint256 version; - Invoice implementation version corresponding to this Invoice.
}
```

`mapping(uint256 => address) public invoiceImplementationByVersion;` - Returns the Invoice implementation address for a specific version.

`mapping(bytes32 => InvoiceInfo) public invoiceDeployed;` - Returns InvoiceInfo for an existing Invoice. If the Invoice does not exist, fields return zero values.

`mapping(bytes32 => mapping(uint256 => bool)) public nonceUsed;` - Returns whether a specific nonce has been used for withdrawFromInvoice for a specific orderID.

#### Functions

##### View

`function getInvoiceAddress(bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external view virtual returns(address)` - Based on CREATE2 parameters, returns the future or current address of the Invoice clone.

`function getInvoiceAddressWithVersion(uint256 version, bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external view virtual returns(address)` - Based on CREATE2 parameters, returns the future or current address of the Invoice clone considering the implementation version.

##### Write

`function initialize(address admin, address validator, address invoiceImplementation) external virtual initializer` - Called once during creation.

`function deployAndProcess(bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline, bytes calldata signature) external virtual whenNotPaused` - Verifies the signature. Deploys the Invoice clone and calls its initialize.

`function withdrawFromInvoice(bytes32 orderID, uint256 nonce, address tokenToWithdraw, uint256 valueToWithdraw, bytes calldata signature) external virtual` - Verifies the signature. Gets the Invoice address and calls `withdraw(tokenToWithdraw, valueToWithdraw)` on it.

`function setInvoiceImplementation(address invoiceImplementation) external virtual onlyRole(DEFAULT_ADMIN_ROLE)` - Sets the Invoice implementation subject to cloning. Increases currentInvoiceImplementationVersion by 1.

`function pause() external virtual onlyRole(DEFAULT_ADMIN_ROLE)` - Sets pause.

`function unpause() external virtual onlyRole(DEFAULT_ADMIN_ROLE)` - Removes pause.

#### Events

`event InvoiceImplementationSet(uint256 indexed version, address invoiceImplementation);` - Occurs upon setting a new Invoice implementation.

`event InvoiceProcessed(bytes32 indexed orderID, address indexed instance, bool accepted);` - Occurs upon Invoice deployment.

`event WithdrawFromInvoice(bytes32 indexed orderID, address indexed instance, address indexed token, uint256 value);` - Occurs upon calling withdrawFromInvoice.

#### Errors

`error InvalidSignature();` - Invalid signature.

`error InvalidInput();` - paymentDeadline >= merchantChoiceDeadline during Invoice deployment.

`error InvoiceDeployed(bytes32 orderID);` - Invoice with the specified orderID already exists.

`error InvoiceNotDeployed(bytes32 orderID);` - Invoice with the specified orderID does not exist.

`error NonceUsed();` - nonce for withdrawFromInvoice for the given orderID has already been used.

#### For Backend Developer

Signing message for deployAndProcess is computed as:

```solidity
bytes32 salt = keccak256(abi.encode(orderID, merchant, customer, token, paymentDeadline, merchantChoiceDeadline));

MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode(block.chainid, address(this), this.deployAndProcess.selector, salt)))
```

Signing message for withdrawFromInvoice is computed as:

```solidity
MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode(block.chainid, address(this), this.withdrawFromInvoice.selector, orderID, nonce, tokenToWithdraw, valueToWithdraw)))
```

---

## Addresses

### Hoodi

[InvoiceEVM](https://hoodi.etherscan.io/address/0x25b76F02AfFB3456019a66DeEab2aeFc60299FC2#code)

[InvoiceFactoryEVM implementation](https://hoodi.etherscan.io/address/0xEcE34C06133d2f5e30888e751d6440250e65C91b#code)

[InvoiceFactoryEVM proxy](https://hoodi.etherscan.io/address/0xB7A004778b954fC25a4BD321c9F2B5b2d95b7365#code)

[ProxyAdmin](https://hoodi.etherscan.io/address/0x6c134bFc1d39e827021bBA36b812B07c6769B8CA#code)

### Nile

[InvoiceTron](https://nile.tronscan.org/contract/TPgJL3MAFhTEGRjAADFTdcWJHVpQVbEVos/code)

[InvoiceFactoryTron implementation](https://nile.tronscan.org/contract/TByD4tUDADjWg4KCDxgeJAL8TRA45cGEXP/code)

[InvoiceFactoryTron proxy](https://nile.tronscan.org/contract/THpuF7YcbSwYh46kxKshbooYy2MNAztp2D/code)

[ProxyAdmin](https://nile.tronscan.org/contract/TZD6rYNA2qYULpMvvYMKG2NyAJ5qFah2sG/code)

---

## Описание смарт-контрактов

### Invoice

Наследуется от OwnableUpgradeable.

Реализации под конкретные сети наследуются от Invoice и меняют поведение, например реализация для EVM поддерживает SafeERC20.

#### Переменные

`address public constant MOCK_NATIVE_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;` - Моковый адрес нативной валюты.

`address public customer;` - Адрес пользователя, устанавливается в initialize.

#### Функции

`function initialize(address merchant, address _customer, IERC20 token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external virtual initializer returns(bool)` - Вызывается один раз при создании. Переводит весь баланс token _customer если текущее время больше merchantChoiceDeadline, переводит весь баланс token merchant если прошлое условие не выполнено и текущее время больше paymentDeadline.

`function withdraw(IERC20 token, uint256 value) external virtual onlyOwner` - Позволяет переводить произвольный токен customer в произвольном объёме. Контролируется InvoiceFactory.

#### Ивенты

`event Accept();` - Возникает если token в initialize переведён merchant.

`event Refund();` - Возникает если token в initialize переведён customer.

`event Withdraw(IERC20 indexed token, uint256 value);` - Возникает при вызове withdraw.

#### Ошибки

`error PaymentDeadlineNotPassed(uint256 paymentDeadline, uint256 currentTimestamp);` - Возникает в initialize если не выполнилось ни одно из условий успешного завершения функции.

`error NativeTransferFailed(address receiver, bytes returnData);` - Возникает при любом неудачном переводе нативной валюты, returnData - возвращённые данные неудачного вызова с переводом.

---

### InvoiceFactory

Наследуется от AccessControlUpgradeable, PausableUpgradeable.

Реализации под конкретные сети наследуются от InvoiceFactory.

#### Переменные

`bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");` - Идентификатор роли валидатора.

`uint256 public currentInvoiceImplementationVersion;` - Текущий номер версии имплементации Invoice. Начинается с 1.

```solidity
struct InvoiceInfo { - Структура информации о созданном Invoice.
    address instance; - Адрес.
    uint256 version; - Версия имплементации Invoice соответствующая данному Invoice.
}
```

`mapping(uint256 => address) public invoiceImplementationByVersion;` - Возвращает адрес имплементации Invoice соответствующий некой версии.

`mapping(bytes32 => InvoiceInfo) public invoiceDeployed;` - Возвращает InvoiceInfo о существующем Invoice. Если Invoice не существует поля будут с нулевыми значениями.

`mapping(bytes32 => mapping(uint256 => bool)) public nonceUsed;` - Возвращает использован ли определённый nonce для withdrawFromInvoice для определённого orderID.

#### Функции

##### View

`function getInvoiceAddress(bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external view virtual returns(address)` - На основе параметров CREATE2 возвращает будущий или текущий адрес клона Invoice.

`function getInvoiceAddressWithVersion(uint256 version, bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external view virtual returns(address)` - На основе параметров CREATE2 возвращает будущий или текущий адрес клона Invoice с учётом версии имплементации.

##### Write

`function initialize(address admin, address validator, address invoiceImplementation) external virtual initializer` - Вызывается один раз при создании.

`function deployAndProcess(bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline, bytes calldata signature) external virtual whenNotPaused` - Проверяет signature. Деплоит Invoice клон и вызывает его initialize.

`function withdrawFromInvoice(bytes32 orderID, uint256 nonce, address tokenToWithdraw, uint256 valueToWithdraw, bytes calldata signature) external virtual` - Проверяет signature. Получает адрес Invoice и вызывает на нём `withdraw(tokenToWithdraw, valueToWithdraw)`.

`function setInvoiceImplementation(address invoiceImplementation) external virtual onlyRole(DEFAULT_ADMIN_ROLE)` - Устанавливает имплементацию Invoice которая подлежит клонированию. Увеличивает currentInvoiceImplementationVersion на 1.

`function pause() external virtual onlyRole(DEFAULT_ADMIN_ROLE)` - Устанавливает паузу.

`function unpause() external virtual onlyRole(DEFAULT_ADMIN_ROLE)` - Снимает паузу.

#### Ивенты

`event InvoiceImplementationSet(uint256 indexed version, address invoiceImplementation);` - Возникает при установке новой имплементации Invoice.

`event InvoiceProcessed(bytes32 indexed orderID, address indexed instance, bool accepted);` - Возникает при деплое Invoice.

`event WithdrawFromInvoice(bytes32 indexed orderID, address indexed instance, address indexed token, uint256 value);` - Возникает при вызове withdrawFromInvoice.

#### Ошибки

`error InvalidSignature();` - Неверная подпись.

`error InvalidInput();` - paymentDeadline >= merchantChoiceDeadline при деплое Invoice.

`error InvoiceDeployed(bytes32 orderID);` - Invoice с указанным orderID уже существует.

`error InvoiceNotDeployed(bytes32 orderID);` - Invoice с указанным orderID не существует.

`error NonceUsed();` - nonce для withdrawFromInvoice для данного orderID уже использован.

#### Для бэкендера

Сообщение для подписи для deployAndProcess вычисляется как:

```solidity
bytes32 salt = keccak256(abi.encode(orderID, merchant, customer, token, paymentDeadline, merchantChoiceDeadline));

MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode(block.chainid, address(this), this.deployAndProcess.selector, salt)))
```

Сообщение для подписи для withdrawFromInvoice вычисляется как:

```solidity
MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode(block.chainid, address(this), this.withdrawFromInvoice.selector, orderID, nonce, tokenToWithdraw, valueToWithdraw)))
```

---

## Адреса

### Hoodi

[InvoiceEVM](https://hoodi.etherscan.io/address/0x25b76F02AfFB3456019a66DeEab2aeFc60299FC2#code)

[Имплементация InvoiceFactoryEVM](https://hoodi.etherscan.io/address/0xEcE34C06133d2f5e30888e751d6440250e65C91b#code)

[Прокси InvoiceFactoryEVM](https://hoodi.etherscan.io/address/0xB7A004778b954fC25a4BD321c9F2B5b2d95b7365#code)

[ProxyAdmin](https://hoodi.etherscan.io/address/0x6c134bFc1d39e827021bBA36b812B07c6769B8CA#code)

### Nile

[InvoiceTron](https://nile.tronscan.org/contract/TPgJL3MAFhTEGRjAADFTdcWJHVpQVbEVos/code)

[Имплементация InvoiceFactoryTron](https://nile.tronscan.org/contract/TByD4tUDADjWg4KCDxgeJAL8TRA45cGEXP/code)

[Прокси InvoiceFactoryTron](https://nile.tronscan.org/contract/THpuF7YcbSwYh46kxKshbooYy2MNAztp2D/code)

[ProxyAdmin](https://nile.tronscan.org/contract/TZD6rYNA2qYULpMvvYMKG2NyAJ5qFah2sG/code)