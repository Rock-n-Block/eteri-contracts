import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const {ADMIN, VALIDATOR, PAUSER, UNPAUSER, MIN_SIGNATURES} = process.env;

export default buildModule("InvoiceFactory", (m) => {

    const InvoiceImplementation = m.contract("InvoiceEVM");
    const InvoiceFactoryImplementation = m.contract("InvoiceFactoryEVM");

    const InvoiceFactoryProxy = m.contract("TransparentUpgradeableProxy",
        [InvoiceFactoryImplementation,
        ADMIN,
        m.encodeFunctionCall(
            InvoiceFactoryImplementation,
            "initialize",
            [ADMIN, VALIDATOR, PAUSER, UNPAUSER, InvoiceImplementation, MIN_SIGNATURES]
        )
    ]);

    const proxyAdminAddress = m.readEventArgument(
        InvoiceFactoryProxy,
        "AdminChanged",
        "newAdmin"
    );

    const ProxyAdmin = m.contractAt(
        "ProxyAdmin", 
        proxyAdminAddress
    );

    return { InvoiceImplementation, InvoiceFactoryImplementation, InvoiceFactoryProxy, ProxyAdmin };
});
