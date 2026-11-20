import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  type Address,
  type Chain,
  type LocalAccount,
} from "viem";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { hardhat, sepolia } from "viem/chains";

// ---------------------------------------------------------------------------
// Ağ profili
// ---------------------------------------------------------------------------
// `npm run dev`          → yerel Hardhat ağı
// `npm run dev:sepolia`  → Sepolia test ağı (.env.sepolia dosyasındaki VITE_AG=sepolia)
export type AgTuru = "yerel" | "sepolia";

export interface AgProfili {
  tur: AgTuru;
  ad: string;
  chain: Chain;
  rpc: string;
  /** Yerel ağda zaman ileri sarılabilir; gerçek ağda sarılamaz. */
  zamanSarilabilir: boolean;
  /** İşlem ve adres bağlantıları için blok gezgini (yerel ağda yok). */
  gezgin: string | null;
}

const env = import.meta.env;
const tur: AgTuru = env.VITE_AG === "sepolia" ? "sepolia" : "yerel";

// Geliştirme kolaylığı: VITE_TEST_YEREL=1 iken Sepolia akışı yerel Hardhat
// zincirinde çalıştırılır (geçici cüzdanlar, geri sayım vb. internetsiz denenebilir).
const testYerel = env.VITE_TEST_YEREL === "1";

export const AG: AgProfili =
  tur === "sepolia"
    ? {
        tur,
        ad: testYerel ? "Sepolia (yerel deneme)" : "Sepolia test ağı",
        chain: testYerel ? hardhat : sepolia,
        rpc: env.VITE_RPC_URL || (testYerel ? "http://127.0.0.1:8545" : "https://ethereum-sepolia-rpc.publicnode.com"),
        zamanSarilabilir: false,
        gezgin: testYerel ? null : "https://sepolia.etherscan.io",
      }
    : {
        tur,
        ad: "Yerel Hardhat ağı",
        chain: hardhat,
        rpc: "http://127.0.0.1:8545",
        zamanSarilabilir: true,
        gezgin: null,
      };

export const chain = AG.chain;
const transport = http(AG.rpc);

export const publicClient = createPublicClient({ chain, transport });
export const testClient = createTestClient({ chain, mode: "hardhat", transport });

// ---------------------------------------------------------------------------
// Roller
// ---------------------------------------------------------------------------
export type RolId = "yonetici" | "stkA" | "stkB" | "stkC" | "tedarikci" | "bagisciAyse" | "bagisciMehmet";

export interface Rol {
  id: RolId;
  ad: string;
  tur: string;
  aciklama: string;
  hesapNo: number;
}

export const ROLLER: Rol[] = [
  {
    id: "yonetici",
    ad: "Kampanya yöneticisi",
    tur: "Yönetici",
    aciklama: "Kampanyayı ve aşamaları açar. Paraya dokunamaz.",
    hesapNo: 0,
  },
  {
    id: "stkA",
    ad: "Umut Derneği",
    tur: "STK",
    aciklama: "Sahada aileleri kaydeder, talepleri girer.",
    hesapNo: 1,
  },
  {
    id: "stkB",
    ad: "Anadolu Yardım Vakfı",
    tur: "STK",
    aciklama: "Kanıtları ve talepleri bağımsız olarak doğrular.",
    hesapNo: 2,
  },
  {
    id: "stkC",
    ad: "Dayanışma Platformu",
    tur: "STK",
    aciklama: "Dağıtım noktasında teslimi kaydeder.",
    hesapNo: 3,
  },
  {
    id: "tedarikci",
    ad: "Yıldız Tekstil",
    tur: "Tedarikçi",
    aciklama: "Battaniyeleri üretir, aşama onaylanınca ödeme alır.",
    hesapNo: 4,
  },
  {
    id: "bagisciAyse",
    ad: "Ayşe",
    tur: "Bağışçı",
    aciklama: "Kampanyaya bağış yapar.",
    hesapNo: 5,
  },
  {
    id: "bagisciMehmet",
    ad: "Mehmet",
    tur: "Bağışçı",
    aciklama: "Kampanyaya bağış yapar.",
    hesapNo: 6,
  },
];

// ---------------------------------------------------------------------------
// Hesaplar
// ---------------------------------------------------------------------------
// Yerel ağ: Hardhat'in herkesin bildiği test anahtarları (her biri 10.000 test ETH).
// Sepolia: her tarayıcıda bir kez üretilip tarayıcıda saklanan GEÇİCİ cüzdanlar.
// Bu cüzdanlar sadece test ağı içindir; gerçek para gönderilmemeli.
const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";
const CUZDAN_ANAHTARI = `afet-bagis-cuzdanlar-${chain.id}`;

function geciciAnahtarlar(): Record<RolId, `0x${string}`> {
  let kayitli: Partial<Record<RolId, `0x${string}`>> = {};
  try {
    kayitli = JSON.parse(localStorage.getItem(CUZDAN_ANAHTARI) ?? "{}");
  } catch {
    /* depolama yoksa yeni anahtarlar üretilir */
  }
  const anahtarlar = Object.fromEntries(ROLLER.map((r) => [r.id, kayitli[r.id] ?? generatePrivateKey()])) as Record<
    RolId,
    `0x${string}`
  >;
  try {
    localStorage.setItem(CUZDAN_ANAHTARI, JSON.stringify(anahtarlar));
  } catch {
    /* önemli değil */
  }
  return anahtarlar;
}

const hesaplar: Record<RolId, LocalAccount> =
  AG.tur === "yerel"
    ? (Object.fromEntries(
        ROLLER.map((r) => [r.id, mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: r.hesapNo })]),
      ) as unknown as Record<RolId, LocalAccount>)
    : (() => {
        const a = geciciAnahtarlar();
        return Object.fromEntries(ROLLER.map((r) => [r.id, privateKeyToAccount(a[r.id])])) as Record<
          RolId,
          LocalAccount
        >;
      })();

export function hesap(rol: RolId) {
  return hesaplar[rol];
}

export function adres(rol: RolId): Address {
  return hesaplar[rol].address;
}

export function cuzdan(rol: RolId) {
  return createWalletClient({ account: hesaplar[rol], chain, transport });
}

export function rolBul(id: RolId): Rol {
  return ROLLER.find((r) => r.id === id)!;
}

export function adrestenRol(a: string): Rol | undefined {
  const k = a.toLowerCase();
  return ROLLER.find((r) => adres(r.id).toLowerCase() === k);
}

/** Ağ erişilebilir ve beklenen zincir mi? */
export async function agKontrol(): Promise<boolean> {
  try {
    const id = await publicClient.getChainId();
    return id === chain.id;
  } catch {
    return false;
  }
}

export function gezginIslem(hash: string): string | null {
  return AG.gezgin ? `${AG.gezgin}/tx/${hash}` : null;
}

export function gezginAdres(a: string): string | null {
  return AG.gezgin ? `${AG.gezgin}/address/${a}` : null;
}
