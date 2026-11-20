import { formatEther } from "viem";
import { adrestenRol } from "./chain";

const sayi = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 4 });
const ince = new Intl.NumberFormat("tr-TR", { maximumSignificantDigits: 3 });
const gasBicim = new Intl.NumberFormat("tr-TR");

export function eth(wei: bigint): string {
  return `${sayi.format(Number(formatEther(wei)))} ETH`;
}

/** Küçük tutarlar (işlem ücreti gibi) için: anlamlı 3 basamak. */
export function ethInce(wei: bigint): string {
  return `${ince.format(Number(formatEther(wei)))} ETH`;
}

export function gas(g: bigint): string {
  return `${gasBicim.format(Number(g))} gas`;
}

export function kisa(hex: string, bas = 6, son = 4): string {
  if (!hex) return "";
  return `${hex.slice(0, bas)}…${hex.slice(-son)}`;
}

export function rolAdi(adres: unknown): string {
  return adrestenRol(String(adres))?.ad ?? kisa(String(adres));
}

export function zaman(saniye: bigint): string {
  return new Date(Number(saniye) * 1000).toLocaleString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
