# b2b-contracts

## Smart Contract Description

### Invoice

Inherits from OwnableUpgradeable.

Network-specific implementations inherit from Invoice and modify behavior, for example, the EVM implementation supports SafeERC20.

#### Variables

`address public constant MOCK_NATIVE_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;` - Mock address of the native currency.

`address public customer;` - Customer address, set in initialize.

#### Functions

`function initialize(address merchant, address _customer, IERC20 token, uint256 value, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external virtual initializer returns(bool)` - Called once during creation. Transfers value of token to _customer if the current time is greater than merchantChoiceDeadline, transfers value of token to merchant if the previous condition is not met and the current time is greater than paymentDeadline.

`function withdraw(IERC20 token, uint256 value) external virtual onlyOwner` - Allows transferring an arbitrary token to customer in an arbitrary amount. Controlled by InvoiceFactory.

#### Events

`event Accept(IERC20 token, uint256 value);` - Occurs if the token in initialize is transferred to merchant.

`event Refund(IERC20 token, uint256 value);` - Occurs if the token in initialize is transferred to customer.

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

`bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");` - Pauser role identifier.

`bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");` - Unpauser role identifier.

`uint256 public currentInvoiceImplementationVersion;` - Current Invoice implementation version number. Starts at 1.

`uint256 public minSignatures;` - Minimum amount unique valid signatures from validators for executing `deployAndProcess` or `withdrawFromInvoice`.

```solidity
struct InvoiceInfo { - Struct containing created Invoice information.
    address instance; - Address.
    uint256 version; - Invoice implementation version corresponding to this Invoice.
}

struct MetaInfo { - Struct containing information to protect against signature replay attacks.
    uint256 chainId; - Network identifier.
    address contractAddress; - InvoiceFactory contract address.
    bytes4 selector; - Selector of the function being called.
}

struct OrderInfo { - Struct containing order information, which is used for deployAndProcess but is not included in salt generation for Invoice clone creation.
    uint256 value; - Token amount being transferred.
    uint256 signaturesDeadline; - Time after which signatures are considered invalid.
    address invoiceImplementation; - Invoice implementation subject to cloning.
}
```

`mapping(uint256 => address) public invoiceImplementationByVersion;` - Returns the Invoice implementation address for a specific version.

`mapping(address => uint256) public versionByInvoiceImplementation;` - Returns Invoice version for a specific implementation.

`mapping(bytes32 => InvoiceInfo) public invoiceDeployed;` - Returns InvoiceInfo for an existing Invoice. If the Invoice does not exist, fields return zero values.

`mapping(bytes32 => mapping(uint256 => bool)) public nonceUsed;` - Returns whether a specific nonce has been used for withdrawFromInvoice for a specific orderID.

`uint256[44] private __gap;` - Technical variable used for reliability of future contract upgrades. The array length must be specified as 50 - the number of storage slots used.

#### Functions

##### View

`function getInvoiceAddress(bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external view virtual returns(address)` - Based on CREATE2 parameters, returns the future or current address of the Invoice clone.

`function getInvoiceAddressWithVersion(uint256 version, bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external view virtual returns(address)` - Based on CREATE2 parameters, returns the future or current address of the Invoice clone considering the implementation version.

##### Write

`function initialize(address admin, address validator, address pauser, address unpauser, address invoiceImplementation, uint256 _minSignatures) external virtual initializer` - Called once during creation.

`function deployAndProcess(bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline, OrderInfo calldata orderInfo, bytes[] calldata signatures) external virtual whenNotPaused` - Verifies signatures. Deploys the Invoice clone and calls its initialize.

`function withdrawFromInvoice(bytes32 orderID, uint256 nonce, address tokenToWithdraw, uint256 valueToWithdraw, uint256 signaturesDeadline, bytes[] calldata signatures) external virtual` - Verifies signatures. Gets the Invoice address and calls `withdraw(tokenToWithdraw, valueToWithdraw)` on it.

`function setInvoiceImplementation(address invoiceImplementation) external virtual onlyRole(DEFAULT_ADMIN_ROLE)` - Sets the current Invoice implementation for address calculation using getInvoiceAddress. Increases currentInvoiceImplementationVersion by 1.

`function setMinSignatures(uint256 _minSignatures) external virtual onlyRole(DEFAULT_ADMIN_ROLE)` - Sets minSignatures.

`function pause() external virtual onlyRole(PAUSER_ROLE)` - Sets pause.

`function unpause() external virtual onlyRole(UNPAUSER_ROLE)` - Removes pause.

#### Events

`event InvoiceImplementationSet(uint256 indexed version, address invoiceImplementation);` - Occurs upon setting a new Invoice implementation.

`event MinSignaturesSet(uint256 minSignatures);` - Occurs upon setting a new minSignatures value.

`event InvoiceProcessed(bytes32 indexed orderID, address indexed instance, address indexed token, uint256 value, bool accepted);` - Occurs upon Invoice deployment.

`event WithdrawFromInvoice(bytes32 indexed orderID, address indexed instance, address indexed token, uint256 value);` - Occurs upon calling withdrawFromInvoice.

#### Errors

`error InvalidSignaturesCount(uint256 minSignatures, uint256 signersLength);` - Incorrect number of valid signatures.

`error SignaturesDeadlinePassed(uint256 signaturesDeadline, uint256 currentTime);` - Signatures are considered invalid because of elapsed time.

`error InvalidInput();` - paymentDeadline >= merchantChoiceDeadline during Invoice deployment.

`error InvoiceDeployed(bytes32 orderID);` - Invoice with the specified orderID already exists.

`error InvoiceNotDeployed(bytes32 orderID);` - Invoice with the specified orderID does not exist.

`error NonceUsed();` - nonce for withdrawFromInvoice for the given orderID has already been used.

#### For Backend Developer

Signing message for deployAndProcess is computed as:

```solidity
bytes32 salt = keccak256(abi.encode(orderID, merchant, customer, token, paymentDeadline, merchantChoiceDeadline));

MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode((block.chainid, address(this), this.deployAndProcess.selector), salt, (value, signaturesDeadline, invoiceImplementation))))
```

Signing message for withdrawFromInvoice is computed as:

```solidity
MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode((block.chainid, address(this), this.withdrawFromInvoice.selector), orderID, nonce, tokenToWithdraw, valueToWithdraw, signaturesDeadline)))
```

---

### Timelock

Inherits from TimelockController.

#### Variables

`uint256 public constant MIN_MIN_DELAY = 48 hours;` - The minimum value for the minDelay parameter.

`uint256 public constant MAX_DELAY = 30 days;` - The maximum value for both the minDelay parameter and the delay argument in schedule and scheduleBatch.

`uint256 public constant PROPOSAL_AUTOMATIC_CANCELLATION_DELAY = 14 days;` - The timeframe after which a proposal in the Ready status automatically cancels.

#### Functions

##### View

`function getTimestamp(bytes32 id) public view override returns (uint256)` - Includes added functionality for the automatic cancellation of proposals in the Ready status.

##### Write

`function schedule(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt, uint256 delay) public override` - Includes added functionality to validate delay against MAX_DELAY.

`function scheduleBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata payloads, bytes32 predecessor, bytes32 salt, uint256 delay) public override` - Includes added functionality to validate delay against MAX_DELAY.

`function updateDelay(uint256 newDelay) public override` - Includes added functionality to validate newDelay against MIN_MIN_DELAY and MAX_DELAY.

#### Errors

`error InvalidNewDelay(uint256 minDelay, uint256 maxDelay, uint256 attemptedDelay);` - Occurs when validation checks fail in the updateDelay function.

`error MaxDelayExceeded(uint256 maxDelay, uint256 attemptedDelay);` - Occurs when validation checks fail in the schedule and scheduleBatch functions.

---

## Addresses

### Hoodi

[InvoiceEVM](https://hoodi.etherscan.io/address/0xdDa548670bD3eE4Fd28A6e26736AF194B5834242#code)

[InvoiceFactoryEVM implementation](https://hoodi.etherscan.io/address/0xA3196f5364662fCc08802d4d4bB6Bb8EB92A74E9#code)

[InvoiceFactoryEVM proxy](https://hoodi.etherscan.io/address/0xdbf0B64A089895877370BDaF2BD159400dA306F7#code)

[ProxyAdmin](https://hoodi.etherscan.io/address/0x32F31b3701d2c4C05D326e0536C17e734a8b7F0a#code)

[Timelock (mock values)](https://hoodi.etherscan.io/address/0xB79a10d75463cD057FD721928A864301bD6046F8#code)

### Nile

[InvoiceTron](https://nile.tronscan.org/contract/TZCmAabqxabASNCsRV4xiQRcyRYUC8bmBy/code)

[InvoiceFactoryTron implementation](https://nile.tronscan.org/contract/TEAmwcXaicLWjJENodNr5d5Rk9S9YaoUtB/code)

[InvoiceFactoryTron proxy](https://nile.tronscan.org/contract/TRtZKNFsXBjVn9Q7DMMdkJ9G8BcjNJ9thC/code)

[ProxyAdmin](https://nile.tronscan.org/contract/TSx1Pj4919coNJ9asWC6qax1wWSKnJy2RY/code)

[Timelock (mock values)](https://nile.tronscan.org/contract/TGc8845Gt4kKMWFJ2Qy3EnEXmwRAQUqPNG/code)

---

## Описание смарт-контрактов

### Invoice

Наследуется от OwnableUpgradeable.

Реализации под конкретные сети наследуются от Invoice и меняют поведение, например реализация для EVM поддерживает SafeERC20.

#### Переменные

`address public constant MOCK_NATIVE_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;` - Моковый адрес нативной валюты.

`address public customer;` - Адрес пользователя, устанавливается в initialize.

#### Функции

`function initialize(address merchant, address _customer, IERC20 token, uint256 value, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external virtual initializer returns(bool)` - Вызывается один раз при создании. Переводит value token _customer если текущее время больше merchantChoiceDeadline, переводит value token merchant если прошлое условие не выполнено и текущее время больше paymentDeadline.

`function withdraw(IERC20 token, uint256 value) external virtual onlyOwner` - Позволяет переводить произвольный токен customer в произвольном объёме. Контролируется InvoiceFactory.

#### Ивенты

`event Accept(IERC20 token, uint256 value);` - Возникает если token в initialize переведён merchant.

`event Refund(IERC20 token, uint256 value);` - Возникает если token в initialize переведён customer.

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

`bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");` - Идентификатор роли паузера.

`bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");` - Идентификатор роли анпаузера.

`uint256 public currentInvoiceImplementationVersion;` - Текущий номер версии имплементации Invoice. Начинается с 1.

`uint256 public minSignatures;` - Минимальное количество уникальных подходящих подписей от валидаторов для исполнения `deployAndProcess` или `withdrawFromInvoice`.

```solidity
struct InvoiceInfo { - Структура информации о созданном Invoice.
    address instance; - Адрес.
    uint256 version; - Версия имплементации Invoice соответствующая данному Invoice.
}

struct MetaInfo { - Структура информации для защиты от атаки повтора подписи.
    uint256 chainId; - Идентификатор сети.
    address contractAddress; - Адрес контракта InvoiceFactory.
    bytes4 selector; - Селектор вызываемой функции.
}

struct OrderInfo { - Структура информации об ордере, используемая для deployAndProcess но не входящая в генерацию соли для создания клона Invoice.
    uint256 value; - Переводимое количество токена.
    uint256 signaturesDeadline; - Время, после которого подписи будут признаны невалидными.
    address invoiceImplementation; - Имплементация Invoice, клон которой необходимо создать.
}
```

`mapping(uint256 => address) public invoiceImplementationByVersion;` - Возвращает адрес имплементации Invoice соответствующий некой версии.

`mapping(address => uint256) public versionByInvoiceImplementation;` - Возвращает версию Invoice соответствующую некой имплементации.

`mapping(bytes32 => InvoiceInfo) public invoiceDeployed;` - Возвращает InvoiceInfo о существующем Invoice. Если Invoice не существует поля будут с нулевыми значениями.

`mapping(bytes32 => mapping(uint256 => bool)) public nonceUsed;` - Возвращает использован ли определённый nonce для withdrawFromInvoice для определённого orderID.

`uint256[44] private __gap;` - Техническая переменная, используемая для надёжности будущих обновлений контракта. Длину массива необходимо указывать как 50 - количество используемых слотов памяти.

#### Функции

##### View

`function getInvoiceAddress(bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external view virtual returns(address)` - На основе параметров CREATE2 возвращает будущий или текущий адрес клона Invoice.

`function getInvoiceAddressWithVersion(uint256 version, bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external view virtual returns(address)` - На основе параметров CREATE2 возвращает будущий или текущий адрес клона Invoice с учётом версии имплементации.

##### Write

`function initialize(address admin, address validator, address pauser, address unpauser, address invoiceImplementation, uint256 _minSignatures) external virtual initializer` - Вызывается один раз при создании.

`function deployAndProcess(bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline, OrderInfo calldata orderInfo, bytes[] calldata signatures) external virtual whenNotPaused` - Проверяет signatures. Деплоит Invoice клон и вызывает его initialize.

`function withdrawFromInvoice(bytes32 orderID, uint256 nonce, address tokenToWithdraw, uint256 valueToWithdraw, uint256 signaturesDeadline, bytes[] calldata signatures) external virtual` - Проверяет signatures. Получает адрес Invoice и вызывает на нём `withdraw(tokenToWithdraw, valueToWithdraw)`.

`function setInvoiceImplementation(address invoiceImplementation) external virtual onlyRole(DEFAULT_ADMIN_ROLE)` - Устанавливает актуальную имплементацию Invoice для расчёта адреса путём getInvoiceAddress. Увеличивает currentInvoiceImplementationVersion на 1.

`function setMinSignatures(uint256 _minSignatures) external virtual onlyRole(DEFAULT_ADMIN_ROLE)` - Устанавливает minSignatures.

`function pause() external virtual onlyRole(PAUSER_ROLE)` - Устанавливает паузу.

`function unpause() external virtual onlyRole(UNPAUSER_ROLE)` - Снимает паузу.

#### Ивенты

`event InvoiceImplementationSet(uint256 indexed version, address invoiceImplementation);` - Возникает при установке новой имплементации Invoice.

`event MinSignaturesSet(uint256 minSignatures);` - Возникает при установке нового значения minSignatures.

`event InvoiceProcessed(bytes32 indexed orderID, address indexed instance, address indexed token, uint256 value, bool accepted);` - Возникает при деплое Invoice.

`event WithdrawFromInvoice(bytes32 indexed orderID, address indexed instance, address indexed token, uint256 value);` - Возникает при вызове withdrawFromInvoice.

#### Ошибки

`error InvalidSignaturesCount(uint256 minSignatures, uint256 signersLength);` - Неверное количество подходящих подписей.

`error SignaturesDeadlinePassed(uint256 signaturesDeadline, uint256 currentTime);` - Подписи считаются неподходящими из-за истечения времени.

`error InvalidInput();` - paymentDeadline >= merchantChoiceDeadline при деплое Invoice.

`error InvoiceDeployed(bytes32 orderID);` - Invoice с указанным orderID уже существует.

`error InvoiceNotDeployed(bytes32 orderID);` - Invoice с указанным orderID не существует.

`error NonceUsed();` - nonce для withdrawFromInvoice для данного orderID уже использован.

#### Для бэкендера

Сообщение для подписи для deployAndProcess вычисляется как:

```solidity
bytes32 salt = keccak256(abi.encode(orderID, merchant, customer, token, paymentDeadline, merchantChoiceDeadline));

MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode((block.chainid, address(this), this.deployAndProcess.selector), salt, (value, signaturesDeadline, invoiceImplementation))))
```

Сообщение для подписи для withdrawFromInvoice вычисляется как:

```solidity
MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode((block.chainid, address(this), this.withdrawFromInvoice.selector), orderID, nonce, tokenToWithdraw, valueToWithdraw, signaturesDeadline)))
```

---

### Timelock

Наследуется от TimelockController.

#### Переменные

`uint256 public constant MIN_MIN_DELAY = 48 hours;` - Минимальное значение параметра minDelay.

`uint256 public constant MAX_DELAY = 30 days;` - Максимальное значение как параметра minDelay так и delay для schedule и scheduleBatch.

`uint256 public constant PROPOSAL_AUTOMATIC_CANCELLATION_DELAY = 14 days;` - Время, спустя которое пропозал находящийся в статусе Ready автоматически отменится.

#### Функции

##### View

`function getTimestamp(bytes32 id) public view override returns (uint256)` - Добавлен функционал автоотмены пропозалов в статусе Ready.

##### Write

`function schedule(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt, uint256 delay) public override` - Добавлен функционал валидации delay против MAX_DELAY.

`function scheduleBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata payloads, bytes32 predecessor, bytes32 salt, uint256 delay) public override` - Добавлен функционал валидации delay против MAX_DELAY.

`function updateDelay(uint256 newDelay) public override` - Добавлен функционал валидации newDelay против MIN_MIN_DELAY и MAX_DELAY.

#### Ошибки

`error InvalidNewDelay(uint256 minDelay, uint256 maxDelay, uint256 attemptedDelay);` - Возникает при неуспешных проверках функции updateDelay.

`error MaxDelayExceeded(uint256 maxDelay, uint256 attemptedDelay);` - Возникает при неуспешной проверке в функциях schedule и scheduleBatch.

---

## Адреса

### Hoodi

[InvoiceEVM](https://hoodi.etherscan.io/address/0xdDa548670bD3eE4Fd28A6e26736AF194B5834242#code)

[Имплементация InvoiceFactoryEVM](https://hoodi.etherscan.io/address/0xA3196f5364662fCc08802d4d4bB6Bb8EB92A74E9#code)

[Прокси InvoiceFactoryEVM](https://hoodi.etherscan.io/address/0xdbf0B64A089895877370BDaF2BD159400dA306F7#code)

[ProxyAdmin](https://hoodi.etherscan.io/address/0x32F31b3701d2c4C05D326e0536C17e734a8b7F0a#code)

[Timelock (моковые значения)](https://hoodi.etherscan.io/address/0xB79a10d75463cD057FD721928A864301bD6046F8#code)

### Nile

[InvoiceTron](https://nile.tronscan.org/contract/TZCmAabqxabASNCsRV4xiQRcyRYUC8bmBy/code)

[Имплементация InvoiceFactoryTron](https://nile.tronscan.org/contract/TEAmwcXaicLWjJENodNr5d5Rk9S9YaoUtB/code)

[Прокси InvoiceFactoryTron](https://nile.tronscan.org/contract/TRtZKNFsXBjVn9Q7DMMdkJ9G8BcjNJ9thC/code)

[ProxyAdmin](https://nile.tronscan.org/contract/TSx1Pj4919coNJ9asWC6qax1wWSKnJy2RY/code)

[Timelock (моковые значения)](https://nile.tronscan.org/contract/TGc8845Gt4kKMWFJ2Qy3EnEXmwRAQUqPNG/code)