import { keccak256, parseEther, parseEventLogs, toHex, type Address, type Hash } from "viem";
import { abi, bytecode } from "../contract/YardimKampanyasi";
import { AG, ROLLER, adres, cuzdan, hesap, publicClient, testClient, type RolId } from "./chain";

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------
export const KATEGORILER = ["Gıda", "Battaniye", "Hijyen", "Bebek maması", "Isınma", "Giyim"] as const;
export const ACILIYET = ["", "Normal", "Yüksek", "Acil"] as const;
export const TALEP_DURUMLARI = ["Beklemede", "Doğrulandı", "Karşılandı", "Reddedildi"] as const;

const SEPOLIA = AG.tur === "sepolia";

/**
 * Kampanya süresi (dakika). Yerel ağda 90 gün: zamanı ileri sararak bitiririz.
 * Sepolia'da zaman sarılamadığı için kısa tutulur; sunum sırasında geri sayımla biter.
 */
export const VARSAYILAN_SURE_DAKIKA = SEPOLIA ? 20 : 90 * 24 * 60;

/** Sepolia'da test ETH'si kıt olduğu için miktarlar küçük. */
export const ASAMALAR = SEPOLIA
  ? [
      { aciklama: "500 battaniye satın alma", tutar: parseEther("0.002") },
      { aciklama: "Bölgeye sevkiyat", tutar: parseEther("0.001") },
    ]
  : [
      { aciklama: "500 battaniye satın alma", tutar: parseEther("1") },
      { aciklama: "Bölgeye sevkiyat", tutar: parseEther("0.5") },
    ];

export const VARSAYILAN_BAGIS = SEPOLIA ? "0.002" : "1";

/** Sepolia'da yöneticinin diğer rollere dağıttığı test ETH'si (gas + bağış için). */
export const DAGITIM_HEDEFI: Partial<Record<RolId, bigint>> = {
  stkA: parseEther("0.006"),
  stkB: parseEther("0.004"),
  stkC: parseEther("0.004"),
  bagisciAyse: parseEther("0.004"),
  bagisciMehmet: parseEther("0.004"),
};

// ---------------------------------------------------------------------------
// Sözleşmenin hata mesajlarının anlaşılır karşılıkları
// ---------------------------------------------------------------------------
export const HATA_ACIKLAMALARI: Record<string, string> = {
  "STK degil": "Bu işlemi sadece kayıtlı STK'lar yapabilir.",
  Yetkisiz: "Bu işlemi sadece kampanya yöneticisi yapabilir.",
  "Kanit uyusmuyor": "İkinci STK farklı bir belgeyi onaylamaya çalıştı. İki onayın aynı kanıta dayanması gerekir.",
  "Zaten onayladin": "Bir STK aynı aşamayı iki kez onaylayamaz.",
  "Sira bu asamada degil": "Aşamalar sırayla onaylanır; bu aşamanın sırası değil.",
  "Asama yok": "Böyle bir aşama yok.",
  "Bagis 0 olamaz": "Bağış miktarı 0 olamaz.",
  "Kampanya sona erdi": "Kampanya süresi doldu; yeni bağış ya da onay kabul edilmiyor.",
  "Sure dolmadi": "Kampanya sürerken iade alınamaz.",
  "Kampanya tamamlandi": "Tüm aşamalar tamamlandığı için iade yok.",
  "Iade edilecek bagis yok": "Bu hesabın iade alacağı bağış kalmadı.",
  "Iade basarisiz": "İade gönderilemedi.",
  "Aile zaten kayitli": "Bu kod zaten kayıtlı.",
  "Kayitsiz aile": "Talep girmek için önce aile kaydedilmeli.",
  "Kayitsiz kod": "Bu kod kayıtlı bir aileye ait değil. Hayalet aileye teslim yazılamaz.",
  "Kaydeden STK teslim edemez": "Aileyi kaydeden STK teslimi kendisi onaylayamaz; ikinci bir kurum gerekir.",
  "Adet 0 olamaz": "Talep adedi 0 olamaz.",
  "Aciliyet 1-3 olmali": "Aciliyet 1 ile 3 arasında olmalı.",
  "Bu kategoride acik talep var": "Ailenin bu kategoride karşılanmamış bir talebi zaten var.",
  "30 gun dolmadi": "Aynı kategoride son teslimin üzerinden 30 gün geçmeden yeni talep açılamaz.",
  "Talep yok": "Böyle bir talep yok.",
  "Talep listesi bos": "En az bir talep seçilmeli.",
  "Liste uzunluklari farkli": "Kategori, adet ve aciliyet listeleri aynı uzunlukta olmalı.",
  "Talep beklemede degil": "Bu talep zaten doğrulanmış ya da reddedilmiş.",
  "Olusturan STK dogrulayamaz": "Talebi giren STK onu kendisi doğrulayamaz.",
  "Talep bu aileye ait degil": "Gösterilen kod, bu talebin ailesine ait değil.",
  "Talep dogrulanmamis": "Sadece doğrulanmış ve henüz karşılanmamış talepler teslim edilebilir.",
};

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------
export function kodHash(kod: string): Hash {
  return keccak256(toHex(kod));
}

export function kanitHash(belgeAdi: string): Hash {
  return keccak256(toHex(belgeAdi));
}

/** Ailelere verilecek okunaklı kod: karışan harfler (0/O, 1/I) yok. */
export function aileKoduUret(): string {
  const harfler = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rastgele = crypto.getRandomValues(new Uint8Array(12));
  const k = Array.from(rastgele, (b) => harfler[b % harfler.length]).join("");
  return `${k.slice(0, 3)}-${k.slice(3, 7)}-${k.slice(7, 11)}`;
}

// ---------------------------------------------------------------------------
// İşlem gönderme
// ---------------------------------------------------------------------------
export interface OlayOzeti {
  ad: string;
  args: Record<string, unknown>;
}

export type IslemSonucu =
  | { ok: true; hash: Hash; gas: bigint; maliyet: bigint; olaylar: OlayOzeti[] }
  | { ok: false; sebep: string; aciklama: string };

function hataCoz(err: unknown): { sebep: string; aciklama: string } {
  // `instanceof` yerine isimle kontrol ediyoruz: paketleyici viem'i iki kez yüklerse
  // sınıflar farklı nesneler olur ve instanceof yanlış sonuç verir.
  const e = err as {
    walk?: (fn: (x: unknown) => boolean) => unknown;
    shortMessage?: string;
    message?: string;
  };
  if (e && typeof e.walk === "function") {
    const revert = e.walk((x) => (x as { name?: string } | null)?.name === "ContractFunctionRevertedError") as {
      reason?: string;
      data?: { errorName?: string };
    } | null;
    if (revert) {
      const sebep = revert.reason ?? revert.data?.errorName ?? "Bilinmeyen hata";
      return { sebep, aciklama: HATA_ACIKLAMALARI[sebep] ?? "" };
    }
  }
  const mesaj = e?.shortMessage ?? e?.message ?? String(err);
  const eslesme = /reverted with (?:the following )?reason:?\s*(?:string\s*)?['"]?([^'"\n]+)/i.exec(mesaj);
  if (eslesme) {
    const sebep = eslesme[1].trim();
    return { sebep, aciklama: HATA_ACIKLAMALARI[sebep] ?? "" };
  }
  return { sebep: mesaj.split("\n")[0], aciklama: "" };
}

/**
 * Bir rol adına sözleşme fonksiyonu çağırır. Önce işlemi simüle eder: zincir
 * reddedecekse hata mesajı işlem gönderilmeden yakalanır.
 */
export async function islemGonder(
  sozlesme: Address,
  rol: RolId,
  fonksiyon: string,
  args: readonly unknown[] = [],
  deger?: bigint,
): Promise<IslemSonucu> {
  try {
    // ABI'den gelen tipler fonksiyon adına göre değiştiği için burada gevşek tutuyoruz.
    const { request } = await publicClient.simulateContract({
      address: sozlesme,
      abi,
      functionName: fonksiyon as never,
      args: args as never,
      account: hesap(rol),
      value: deger,
    } as never);
    const hash = await cuzdan(rol).writeContract(request as never);
    const makbuz = await publicClient.waitForTransactionReceipt({ hash });
    const olaylar = parseEventLogs({ abi, logs: makbuz.logs }).map((l) => ({
      ad: l.eventName as string,
      args: (l.args ?? {}) as Record<string, unknown>,
    }));
    return { ok: true, hash, gas: makbuz.gasUsed, maliyet: makbuz.gasUsed * makbuz.effectiveGasPrice, olaylar };
  } catch (err) {
    return { ok: false, ...hataCoz(err) };
  }
}

/** Yönetici yeni bir kampanya yükler ve iki aşamayı ekler. */
export async function kampanyaKur(
  sureDakika: number,
  ilerleme?: (mesaj: string) => void,
): Promise<{ adres: Address; baslangicBlogu: bigint }> {
  ilerleme?.("Sözleşme yükleniyor (1/3)");
  const hash = await cuzdan("yonetici").deployContract({
    abi,
    bytecode,
    args: [
      [adres("stkA"), adres("stkB"), adres("stkC")],
      adres("tedarikci"),
      BigInt(Math.max(1, Math.round(sureDakika))),
    ],
  });
  const makbuz = await publicClient.waitForTransactionReceipt({ hash });
  const sozlesme = makbuz.contractAddress!;
  for (const [i, a] of ASAMALAR.entries()) {
    ilerleme?.(`Aşama ekleniyor (${i + 2}/3)`);
    const s = await islemGonder(sozlesme, "yonetici", "asamaEkle", [a.aciklama, a.tutar]);
    if (!s.ok) throw new Error(s.sebep);
  }
  return { adres: sozlesme, baslangicBlogu: makbuz.blockNumber };
}

/**
 * Sepolia: yönetici cüzdanındaki test ETH'sini diğer rollere dağıtır.
 * Her rolün bakiyesini hedefe tamamlar; tekrar çalıştırmak güvenlidir.
 */
export async function rollereDagit(): Promise<number> {
  const yonetici = cuzdan("yonetici");
  const eksikler: { rol: RolId; miktar: bigint }[] = [];
  for (const [rol, hedef] of Object.entries(DAGITIM_HEDEFI) as [RolId, bigint][]) {
    const bakiye = await publicClient.getBalance({ address: adres(rol) });
    if (bakiye < hedef) eksikler.push({ rol, miktar: hedef - bakiye });
  }
  if (eksikler.length === 0) return 0;

  // İşlemleri peş peşe gönderip hepsini birlikte bekliyoruz (her biri ~12 sn sürmesin diye)
  let nonce = await publicClient.getTransactionCount({ address: adres("yonetici"), blockTag: "pending" });
  const hashler: Hash[] = [];
  for (const e of eksikler) {
    hashler.push(await yonetici.sendTransaction({ to: adres(e.rol), value: e.miktar, nonce: nonce++ }));
  }
  await Promise.all(hashler.map((hash) => publicClient.waitForTransactionReceipt({ hash })));
  return eksikler.length;
}

export function dagitimToplami(): bigint {
  return Object.values(DAGITIM_HEDEFI).reduce((a, b) => a + (b ?? 0n), 0n);
}

/** Tüm rollerin bakiyeleri (kampanya olmadan da okunabilir). */
export async function bakiyeleriOku(): Promise<Record<RolId, bigint>> {
  const liste = await Promise.all(ROLLER.map((r) => publicClient.getBalance({ address: adres(r.id) })));
  return Object.fromEntries(ROLLER.map((r, i) => [r.id, liste[i]])) as Record<RolId, bigint>;
}

/** Bir kampanyanın yöneticisi bu tarayıcının yönetici cüzdanı mı? Değilse salt okunur. */
export async function yoneticiMi(sozlesme: Address): Promise<boolean> {
  try {
    const y = (await publicClient.readContract({ address: sozlesme, abi, functionName: "yonetici" })) as Address;
    return y.toLowerCase() === adres("yonetici").toLowerCase();
  } catch {
    return false;
  }
}

/** Yerel ağda zamanı ileri sarar (sadece Hardhat ağında çalışır). */
export async function zamaniIleriSar(saniye: number) {
  await testClient.increaseTime({ seconds: saniye });
  await testClient.mine({ blocks: 1 });
}

export async function sozlesmeVarMi(a: Address): Promise<boolean> {
  try {
    const kod = await publicClient.getCode({ address: a });
    return !!kod && kod !== "0x";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Durum okuma
// ---------------------------------------------------------------------------
export interface Asama {
  aciklama: string;
  tutar: bigint;
  onaySayisi: bigint;
  tamamlandi: boolean;
}

export interface Talep {
  id: number;
  aileHash: Hash;
  kategori: number;
  adet: bigint;
  aciliyet: number;
  olusturan: Address;
  dogrulayan: Address;
  durum: number;
}

export interface Durum {
  kasa: bigint;
  toplamBagis: bigint;
  siradakiAsama: bigint;
  asamalar: Asama[];
  ihtiyac: bigint[];
  toplamTeslim: bigint;
  talepler: Talep[];
  sonTarih: bigint;
  zincirSaati: bigint;
  /** Durumun okunduğu andaki tarayıcı saati (ms); zincir saatini canlı tahmin etmek için */
  okunmaZamani: number;
  bakiyeler: Record<RolId, bigint>;
  bagislar: Partial<Record<RolId, bigint>>;
}

export async function durumOku(sozlesme: Address): Promise<Durum> {
  const oku = (functionName: string, args: readonly unknown[] = []) =>
    publicClient.readContract({ address: sozlesme, abi, functionName, args } as never) as Promise<unknown>;

  const [kasa, toplamBagis, siradakiAsama, asamaSayisi, ihtiyac, toplamTeslim, talepSayisi, sonTarih, blok] =
    await Promise.all([
      publicClient.getBalance({ address: sozlesme }),
      oku("toplamBagis") as Promise<bigint>,
      oku("siradakiAsama") as Promise<bigint>,
      oku("asamaSayisi") as Promise<bigint>,
      oku("ihtiyacTablosu") as Promise<readonly bigint[]>,
      oku("toplamTeslim") as Promise<bigint>,
      oku("talepSayisi") as Promise<bigint>,
      oku("sonTarih") as Promise<bigint>,
      publicClient.getBlock(),
    ]);

  const asamalar = await Promise.all(
    Array.from({ length: Number(asamaSayisi) }, async (_, i) => {
      const [aciklama, tutar, onaySayisi, tamamlandi] = (await oku("asamalar", [BigInt(i)])) as [
        string,
        bigint,
        bigint,
        boolean,
        Hash,
      ];
      return { aciklama, tutar, onaySayisi, tamamlandi };
    }),
  );

  const talepler = await Promise.all(
    Array.from({ length: Number(talepSayisi) }, async (_, i) => {
      const t = (await oku("talepGetir", [BigInt(i)])) as Omit<Talep, "id">;
      return { ...t, id: i, kategori: Number(t.kategori), aciliyet: Number(t.aciliyet), durum: Number(t.durum) };
    }),
  );

  const bakiyeListesi = await Promise.all(ROLLER.map((r) => publicClient.getBalance({ address: adres(r.id) })));
  const bakiyeler = Object.fromEntries(ROLLER.map((r, i) => [r.id, bakiyeListesi[i]])) as Record<RolId, bigint>;

  const bagisciRolleri: RolId[] = ["bagisciAyse", "bagisciMehmet"];
  const bagisListesi = await Promise.all(bagisciRolleri.map((r) => oku("bagislar", [adres(r)]) as Promise<bigint>));
  const bagislar = Object.fromEntries(bagisciRolleri.map((r, i) => [r, bagisListesi[i]]));

  return {
    kasa,
    toplamBagis,
    siradakiAsama,
    asamalar,
    ihtiyac: [...ihtiyac],
    toplamTeslim,
    talepler,
    sonTarih,
    zincirSaati: blok.timestamp,
    okunmaZamani: Date.now(),
    bakiyeler,
    bagislar,
  };
}

// ---------------------------------------------------------------------------
// Olay defteri: zincirdeki tüm olaylar
// ---------------------------------------------------------------------------
export interface ZincirOlayi {
  tur: "zincir";
  anahtar: string;
  ad: string;
  args: Record<string, unknown>;
  hash: Hash;
  blok: bigint;
  sira: number;
  gas: bigint;
  zaman: bigint;
}

/** Herkese açık RPC'ler tek sorguda sınırlı blok aralığına izin verir; aralığı parçalara bölüyoruz. */
const LOG_PARCA = 40_000n;

/** Zincirin şu anki saatini tahmin eder (son bloğun saati + o zamandan beri geçen süre). */
export function tahminiZincirSaati(d: Durum, simdiMs = Date.now()): number {
  return Number(d.zincirSaati) + Math.floor((simdiMs - d.okunmaZamani) / 1000);
}

export async function olaylariGetir(sozlesme: Address, baslangicBlogu: bigint): Promise<ZincirOlayi[]> {
  const sonBlok = await publicClient.getBlockNumber();
  const loglar = [];
  for (let bas = baslangicBlogu; bas <= sonBlok; bas += LOG_PARCA) {
    const son = bas + LOG_PARCA - 1n < sonBlok ? bas + LOG_PARCA - 1n : sonBlok;
    loglar.push(...(await publicClient.getContractEvents({ address: sozlesme, abi, fromBlock: bas, toBlock: son })));
  }

  const hashler = [...new Set(loglar.map((l) => l.transactionHash))];
  const bloklar = [...new Set(loglar.map((l) => l.blockNumber))];
  const [makbuzlar, blokBilgileri] = await Promise.all([
    Promise.all(hashler.map((hash) => publicClient.getTransactionReceipt({ hash }))),
    Promise.all(bloklar.map((blockNumber) => publicClient.getBlock({ blockNumber }))),
  ]);
  const gasMap = new Map(makbuzlar.map((m) => [m.transactionHash, m.gasUsed]));
  const zamanMap = new Map(blokBilgileri.map((b) => [b.number, b.timestamp]));

  return loglar.map((l) => ({
    tur: "zincir" as const,
    anahtar: `${l.transactionHash}-${l.logIndex}`,
    ad: l.eventName,
    args: (l.args ?? {}) as Record<string, unknown>,
    hash: l.transactionHash,
    blok: l.blockNumber,
    sira: l.logIndex,
    gas: gasMap.get(l.transactionHash) ?? 0n,
    zaman: zamanMap.get(l.blockNumber) ?? 0n,
  }));
}
