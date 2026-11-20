// Hardhat'in derlediği sözleşmeyi (ABI + bytecode) siteye kopyalar.
// Yerelde: önce proje kökünde `npx hardhat build` çalıştırılmış olmalı.
// Vercel gibi ortamlarda `artifacts` klasörü yoktur; o zaman repoya eklenmiş
// src/contract/YardimKampanyasi.ts dosyası olduğu gibi kullanılır.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const artifactPath = resolve(here, "../../artifacts/contracts/YardimKampanyasi.sol/YardimKampanyasi.json");
const outPath = resolve(here, "../src/contract/YardimKampanyasi.ts");

if (!existsSync(artifactPath)) {
  if (existsSync(outPath)) {
    console.log("ℹ Derlenmiş sözleşme bulunamadı; repodaki ABI dosyası kullanılıyor.");
    process.exit(0);
  }
  console.error(
    "\n✖ Derlenmiş sözleşme bulunamadı.\n" +
      "  Proje kök klasöründe önce şunu çalıştır:  npx hardhat build --build-profile production\n",
  );
  process.exit(1);
}

const { abi, bytecode } = JSON.parse(readFileSync(artifactPath, "utf8"));
const content =
  "// Bu dosya scripts/sync-abi.mjs tarafından otomatik üretilir. Elle düzenleme.\n" +
  `export const abi = ${JSON.stringify(abi, null, 2)} as const;\n\n` +
  `export const bytecode = "${bytecode}" as const;\n`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, content);
console.log("✔ Sözleşme ABI'si siteye kopyalandı.");
