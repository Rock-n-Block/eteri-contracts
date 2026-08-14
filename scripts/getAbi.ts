import fs from "fs";

export function getAbi() {
    const INPUT_PATH = ["./artifacts/contracts/base/Invoice.sol/Invoice.json",
        "./artifacts/contracts/base/InvoiceFactory.sol/InvoiceFactory.json"];
    const NAMES = ["Invoice", "InvoiceFactory"];
    const OUTPUT_PATH = "./abi/";

    fs.mkdirSync(OUTPUT_PATH, { recursive: true });
    for (let i = 0; i < INPUT_PATH.length; i++) {
        fs.writeFileSync(OUTPUT_PATH + NAMES[i] + ".json", JSON.stringify(JSON.parse(fs.readFileSync(INPUT_PATH[i]).toString()).abi));
    }
}