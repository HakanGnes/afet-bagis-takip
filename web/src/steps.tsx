import { useEffect, useState, type ReactNode } from "react";
import { parseEther } from "viem";
import { Eylem, type EylemSonucu } from "./components/Eylem";
import { AG, ROLLER, adres, gezginAdres, type RolId } from "./lib/chain";
import { eth, kisa } from "./lib/bicim";
import {
  ACILIYET,
  ASAMALAR,
  DAGITIM_HEDEFI,
  KATEGORILER,
  TALEP_DURUMLARI,
  dagitimToplami,
  kanitHash,
  kodHash,
  tahminiZincirSaati,
  type Durum,
} from "./lib/kampanya";

/** Talep formunda her kategori için bir satır */
export interface TalepSatiri {
  secili: boolean;
  adet: number;
  aciliyet: number;
}

export type TalepFormu = TalepSatiri[];

export const VARSAYILAN_TALEP_FORMU: TalepFormu = [
  { secili: true, adet: 2, aciliyet: 2 }, // Gıda
  { secili: true, adet: 4, aciliyet: 3 }, // Battaniye
  { secili: true, adet: 1, aciliyet: 1 }, // Hijyen
  { secili: false, adet: 1, aciliyet: 2 }, // Bebek maması
  { secili: true, adet: 1, aciliyet: 3 }, // Isınma
  { secili: false, adet: 3, aciliyet: 1 }, // Giyim
];

export interface Baglam {
  durum: Durum | null;
  bakiyeler: Record<RolId, bigint> | null;
  basladi: boolean;
  saltOkunur: boolean;
  hileGoster: boolean;
  mesgul: string | null;
  ilerleme: string | null;
  sonuclar: Record<string, EylemSonucu>;
  calistir: (id: string, rol: RolId, fonksiyon: string, args?: readonly unknown[], deger?: bigint) => void;
  kampanyaBaslat: () => void;
  dagit: () => void;
  bakiyeYenile: () => void;
  zamanSar: (id: string, saniye: number) => void;
  sureDakika: number;
  setSureDakika: (v: number) => void;
  aileKodu: string;
  yeniKod: () => void;
  belge: string;
  setBelge: (v: string) => void;
  miktarlar: Record<"ayse" | "mehmet", string>;
  setMiktar: (kim: "ayse" | "mehmet", v: string) => void;
  talepFormu: TalepFormu;
  setTalepFormu: (f: TalepFormu) => void;
  teslimKodu: string;
  setTeslimKodu: (v: string) => void;
  /** Teslim adımında işareti kaldırılan (bu dağıtımda teslim edilmeyecek) talepler */
  teslimHaric: number[];
  setTeslimHaric: (v: number[]) => void;
}

export interface Adim {
  /** Rayda görünen numara; hazırlık adımı 0 */
  no: number;
  kisaAd: string;
  baslik: string;
  icerik: (b: Baglam) => ReactNode;
}

const SAHTE_BELGE = "sahte-fatura.pdf";
const UYDURMA_KOD = "HYL-0000-0000";
const GUN = 24 * 60 * 60;

function E(b: Baglam, p: Omit<Parameters<typeof Eylem>[0], "sonuc" | "mesgul">) {
  if (b.saltOkunur) return null;
  if (p.hile && !b.hileGoster) return null;
  const kampanyaGerekmez = p.id === "kur" || p.id === "dagit";
  return (
    <Eylem
      key={p.id}
      {...p}
      sonuc={b.sonuclar[p.id]}
      mesgul={b.mesgul}
      bekleyenYazi={b.mesgul === p.id && b.ilerleme ? b.ilerleme : p.bekleyenYazi}
      devreDisi={p.devreDisi || (!b.basladi && !kampanyaGerekmez)}
    />
  );
}

function miktarOku(v: string): bigint | null {
  try {
    const temiz = v.replace(",", ".").trim();
    if (!temiz) return null;
    return parseEther(temiz);
  } catch {
    return null;
  }
}

function ailedenTalepler(b: Baglam) {
  if (!b.durum) return [];
  if (b.saltOkunur) return b.durum.talepler; // paylaşılan kampanyada aile kodunu bilmiyoruz
  if (!b.aileKodu) return [];
  const h = kodHash(b.aileKodu).toLowerCase();
  return b.durum.talepler.filter((t) => t.aileHash.toLowerCase() === h);
}

function sonTalep(b: Baglam, durum: number) {
  const liste = ailedenTalepler(b).filter((t) => t.durum === durum);
  return liste.length ? liste[liste.length - 1] : undefined;
}

function BaslamadiNotu({ b }: { b: Baglam }) {
  if (b.saltOkunur) {
    return (
      <p className="not">
        Bu adımın işlemlerini kampanyayı başlatan kişi yapar. Sonuçları sağdaki defterde, zincirden okunmuş olarak
        görüyorsun.
      </p>
    );
  }
  if (b.basladi) return null;
  return <p className="not not--uyari">Bu adımı denemek için önce "Kampanyayı kur" adımında kampanyayı başlat.</p>;
}

function Neden({ children }: { children: ReactNode }) {
  return (
    <div className="neden">
      <h3>Neden önemli?</h3>
      {children}
    </div>
  );
}

function Hileler({ b, children, baslik = "Hileyi dene" }: { b: Baglam; children: ReactNode; baslik?: string }) {
  if (!b.hileGoster || b.saltOkunur) return null;
  return (
    <section className="hileler">
      <h3>{baslik}</h3>
      <p className="hileler__giris">
        Bu denemelerin her birini sözleşmenin kendisi durduruyor. Sonucu kırmızı damgada gör.
      </p>
      {children}
    </section>
  );
}

function GeriSayim({ durum }: { durum: Durum }) {
  const [simdi, setSimdi] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setSimdi(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const kalan = Math.max(0, Number(durum.sonTarih) - tahminiZincirSaati(durum, simdi));
  const dk = Math.floor(kalan / 60);
  const sn = kalan % 60;
  return (
    <div className="geri-sayim" role="timer" aria-live="off">
      {kalan > 0 ? (
        <>
          <span className="geri-sayim__sayi">
            {dk}:{String(sn).padStart(2, "0")}
          </span>
          <span>kampanyanın bitmesine kalan süre. Bitince iade düğmeleri çalışır.</span>
        </>
      ) : (
        <span>Kampanya süresi doldu. İade alınabilir.</span>
      )}
    </div>
  );
}

const HAZIRLIK: Adim = {
  no: 0,
  kisaAd: "Hazırlık",
  baslik: "",
  icerik: (b) => {
    const y = adres("yonetici");
    const yb = b.bakiyeler?.yonetici ?? 0n;
    if (b.saltOkunur) {
      return (
        <p className="giris">
          Bu kampanya Sepolia'da başkası tarafından yürütülüyor. Adımlardaki açıklamaları okuyabilir, sağdaki defterde
          zincirdeki gerçek kayıtları görebilirsin. Kendi kampanyanı denemek için üstteki "Kendi demonu başlat"
          düğmesini kullan.
        </p>
      );
    }
    return (
      <>
        <ol className="duz-liste hazirlik">
          <li>
            Yönetici cüzdanının adresini kopyala:
            <code className="adres-kutu">{y}</code>
          </li>
          <li>
            <a
              href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia"
              target="_blank"
              rel="noreferrer"
            >
              Google Cloud Sepolia faucet
            </a>{" "}
            sayfasında Google hesabınla giriş yap, adresi yapıştır ve test ETH'si iste. Birkaç dakika içinde gelir.
          </li>
          <li>Bakiye göründükten sonra aşağıdaki düğmeyle diğer rollere işlem ücreti için pay dağıt.</li>
        </ol>
        <table className="tablo">
          <caption>Rollerin cüzdanları</caption>
          <thead>
            <tr>
              <th scope="col">Rol</th>
              <th scope="col">Adres</th>
              <th scope="col">Bakiye</th>
              <th scope="col">Hedef</th>
            </tr>
          </thead>
          <tbody>
            {ROLLER.map((r) => {
              const link = gezginAdres(adres(r.id));
              const hedef = DAGITIM_HEDEFI[r.id];
              return (
                <tr key={r.id}>
                  <td>{r.ad}</td>
                  <td>
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer">
                        <code>{kisa(adres(r.id))}</code>
                      </a>
                    ) : (
                      <code>{kisa(adres(r.id))}</code>
                    )}
                  </td>
                  <td>{b.bakiyeler ? eth(b.bakiyeler[r.id]) : "…"}</td>
                  <td>{hedef ? eth(hedef) : r.id === "yonetici" ? "faucet'ten" : "gerekmez"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="not">
          Dağıtım için yaklaşık {eth(dagitimToplami())}, sözleşmeyi yüklemek için de bir miktar daha gerekiyor.
          Faucet'ten en az 0,05 ETH almak güvenli.
        </p>
        {E(b, {
          id: "dagit",
          rol: "yonetici",
          etiket: "Rollere test ETH dağıt",
          devreDisi: yb === 0n,
          ipucu: yb === 0n ? "Yönetici cüzdanına test ETH'si gelince düğme açılır." : undefined,
          onClick: b.dagit,
        })}
        <button type="button" className="dugme dugme--ikincil" onClick={b.bakiyeYenile} disabled={b.mesgul !== null}>
          Bakiyeleri yenile
        </button>
        <Neden>
          <p>
            Cüzdanların anahtarları sadece bu tarayıcıda saklanıyor; tarayıcı verilerini silersen cüzdanlar da gider.
            Test ağı olduğu için bunun bir maliyeti yok, ama bu anahtarlara asla gerçek ETH gönderme.
          </p>
        </Neden>
      </>
    );
  },
};

export function adimlariGetir(): Adim[] {
  return AG.tur === "sepolia" ? [HAZIRLIK, ...ADIMLAR] : ADIMLAR;
}

const ADIMLAR: Adim[] = [
  // -------------------------------------------------------------------------
  {
    no: 1,
    kisaAd: "Kampanyayı kur",
    baslik: "Kampanyayı kur",
    icerik: (b) => (
      <>
        <p className="giris">
          Depremden etkilenen bir konteyner kent için battaniye kampanyası açıyoruz. Bağışlar hiçbir kişinin ya da
          kurumun hesabına gitmiyor: bir akıllı sözleşmede bekliyor ve sadece kurallar sağlandığında hareket ediyor.
        </p>
        <h3 className="ara-baslik">Senaryodaki roller</h3>
        <ul className="roller">
          {ROLLER.map((r) => (
            <li key={r.id}>
              <span className={`rol rol--${r.tur === "STK" ? "stk" : r.id}`}>{r.ad}</span>
              <span className="roller__tur">{r.tur}</span>
              <span className="roller__aciklama">{r.aciklama}</span>
            </li>
          ))}
        </ul>
        <h3 className="ara-baslik">Kampanyanın aşamaları</h3>
        <ol className="duz-liste">
          {ASAMALAR.map((a) => (
            <li key={a.aciklama}>
              {a.aciklama}: {eth(a.tutar)}
            </li>
          ))}
        </ol>
        {AG.zamanSarilabilir ? (
          <p>
            Kampanya 90 gün sürüyor. Her aşamanın parası, üç STK'dan ikisi aynı kanıtı onayladığında tedarikçiye
            ödeniyor.
          </p>
        ) : (
          <>
            <p>
              Her aşamanın parası, üç STK'dan ikisi aynı kanıtı onayladığında tedarikçiye ödeniyor. Gerçek bir ağda
              zamanı ileri saramadığımız için kampanya kısa sürüyor; süre dolunca son adımda iade gösterilebiliyor.
            </p>
            {!b.basladi && !b.saltOkunur && (
              <label className="alan-tek">
                Kampanya süresi (dakika)
                <input
                  type="number"
                  min={2}
                  value={b.sureDakika}
                  onChange={(e) => b.setSureDakika(Math.max(2, Number(e.target.value)))}
                />
              </label>
            )}
          </>
        )}
        {E(b, {
          id: "kur",
          rol: "yonetici",
          etiket: b.basladi ? "Kampanya başlatıldı" : "Kampanyayı başlat",
          onClick: b.kampanyaBaslat,
          devreDisi: b.basladi || (AG.tur === "sepolia" && (b.bakiyeler?.yonetici ?? 0n) === 0n),
          ipucu:
            AG.tur === "sepolia" && !b.basladi && (b.bakiyeler?.yonetici ?? 0n) === 0n
              ? "Yönetici cüzdanında test ETH'si yok. Önce hazırlık adımını tamamla."
              : AG.tur === "sepolia" && !b.basladi
                ? "Sözleşme yükleme ve iki aşama ekleme Sepolia'da yaklaşık 30–45 saniye sürer."
                : undefined,
        })}
        {b.basladi && (
          <p className="not">
            Sözleşme {AG.tur === "yerel" ? "yerel ağa" : "Sepolia'ya"} yüklendi ve iki aşama eklendi. Sağdaki defter
            artık zinciri canlı okuyor. Baştan başlamak için üst menüdeki <strong>Demoyu sıfırla</strong> düğmesini
            kullan.
          </p>
        )}
        <Neden>
          <p>
            Yönetici kampanyayı açabiliyor ama parayı çekecek bir fonksiyonu yok. Sözleşmenin kodu herkese açık olduğu
            için bu kural herkes tarafından doğrulanabilir.
          </p>
        </Neden>
      </>
    ),
  },
  // -------------------------------------------------------------------------
  {
    no: 2,
    kisaAd: "Bağış topla",
    baslik: "Bağış topla",
    icerik: (b) => {
      const ayse = miktarOku(b.miktarlar.ayse);
      const mehmet = miktarOku(b.miktarlar.mehmet);
      return (
        <>
          <BaslamadiNotu b={b} />
          <p className="giris">
            Ayşe ve Mehmet kampanyaya bağış yapıyor. Her bağış, bağışçının adresi ve miktarıyla zincire kaydediliyor.
          </p>
          <div className="alanlar">
            <label>
              Ayşe'nin bağışı (ETH)
              <input
                inputMode="decimal"
                value={b.miktarlar.ayse}
                onChange={(e) => b.setMiktar("ayse", e.target.value)}
              />
            </label>
            <label>
              Mehmet'in bağışı (ETH)
              <input
                inputMode="decimal"
                value={b.miktarlar.mehmet}
                onChange={(e) => b.setMiktar("mehmet", e.target.value)}
              />
            </label>
          </div>
          {E(b, {
            id: "bagis-ayse",
            rol: "bagisciAyse",
            etiket: "Bağış yap",
            onClick: () => b.calistir("bagis-ayse", "bagisciAyse", "bagisYap", [], ayse ?? 0n),
            devreDisi: ayse === null,
          })}
          {E(b, {
            id: "bagis-mehmet",
            rol: "bagisciMehmet",
            etiket: "Bağış yap",
            onClick: () => b.calistir("bagis-mehmet", "bagisciMehmet", "bagisYap", [], mehmet ?? 0n),
            devreDisi: mehmet === null,
          })}
          <Hileler b={b}>
            {E(b, {
              id: "hile-bagis-sifir",
              rol: "bagisciAyse",
              etiket: "0 ETH bağışlamaya çalış",
              hile: true,
              onClick: () => b.calistir("hile-bagis-sifir", "bagisciAyse", "bagisYap", [], 0n),
            })}
          </Hileler>
          <Neden>
            <p>
              Defterdeki "Kasa" rakamı sözleşmenin kendi bakiyesi. Kimse bu parayı kişisel cüzdanına aktaramaz; para
              sadece sonraki adımlardaki kurallarla hareket edebilir.
            </p>
          </Neden>
        </>
      );
    },
  },
  // -------------------------------------------------------------------------
  {
    no: 3,
    kisaAd: "Aşamayı onayla",
    baslik: "Aşamayı onayla",
    icerik: (b) => {
      const h = kanitHash(b.belge);
      return (
        <>
          <BaslamadiNotu b={b} />
          <p className="giris">
            Tedarikçi 500 battaniyeyi teslim etti ve faturasını kesti. Faturanın kendisi zincire yazılmıyor; sadece
            parmak izi (hash) yazılıyor. Belgenin tek harfi değişse parmak izi tamamen değişir.
          </p>
          <label className="alan-tek">
            Fatura dosyasının adı
            <input value={b.belge} onChange={(e) => b.setBelge(e.target.value)} />
          </label>
          <p className="hash">
            Zincire yazılacak parmak izi <code>{kisa(h, 14, 10)}</code>
          </p>
          {E(b, {
            id: "onay-a",
            rol: "stkA",
            etiket: "Faturayı onayla",
            ipucu: "Tek onay yetmez: bu adımdan sonra para hâlâ kasada.",
            onClick: () => b.calistir("onay-a", "stkA", "onayla", [0n, h]),
          })}
          {E(b, {
            id: "onay-b",
            rol: "stkB",
            etiket: "Aynı faturayı onayla",
            ipucu: "İkinci onayla eşik doluyor ve 1 ETH otomatik olarak tedarikçiye gidiyor.",
            onClick: () => b.calistir("onay-b", "stkB", "onayla", [0n, h]),
          })}
          <Hileler b={b}>
            {E(b, {
              id: "hile-onay-yonetici",
              rol: "yonetici",
              etiket: "Ödemeyi kendin onaylamaya çalış",
              hile: true,
              onClick: () => b.calistir("hile-onay-yonetici", "yonetici", "onayla", [0n, h]),
            })}
            {E(b, {
              id: "hile-onay-sahte",
              rol: "stkC",
              etiket: "Sahte faturayı onaylamaya çalış",
              hile: true,
              ipucu: "Umut Derneği onayladıktan sonra, Anadolu Yardım Vakfı onaylamadan önce dene.",
              onClick: () => b.calistir("hile-onay-sahte", "stkC", "onayla", [0n, kanitHash(SAHTE_BELGE)]),
            })}
            {E(b, {
              id: "hile-onay-tekrar",
              rol: "stkA",
              etiket: "İkinci kez onaylamaya çalış",
              hile: true,
              ipucu: "Umut Derneği'nin tek başına eşiği doldurmasını dener.",
              onClick: () => b.calistir("hile-onay-tekrar", "stkA", "onayla", [0n, h]),
            })}
          </Hileler>
          <Neden>
            <p>
              Para ancak iki bağımsız kurum aynı belgeyi onaylarsa çıkıyor. Tek bir kurumun ya da yöneticinin sahte
              fatura ile para çekmesi mümkün değil; bunun için en az iki kurumun anlaşması gerekir.
            </p>
          </Neden>
        </>
      );
    },
  },
  // -------------------------------------------------------------------------
  {
    no: 4,
    kisaAd: "Aileyi kaydet",
    baslik: "Aileyi kaydet",
    icerik: (b) => (
      <>
        <BaslamadiNotu b={b} />
        <p className="giris">
          Umut Derneği konteyner kentte bir aileyle görüşüyor ve aileye rastgele bir kod veriyor. Ailenin adı, kimlik
          numarası ya da adresi zincire hiç yazılmıyor.
        </p>
        <div className="kod-karti" aria-label="Aileye verilen kart">
          <span className="kod-karti__etiket">Aileye verilen kart</span>
          <span className="kod-karti__kod">{b.aileKodu}</span>
          <span className="kod-karti__alt">Teslimatta bu kodu gösterin</span>
        </div>
        <p className="hash">
          Zincire yazılan <code>{kisa(kodHash(b.aileKodu), 14, 10)}</code>
        </p>
        <button type="button" className="dugme dugme--ikincil" onClick={b.yeniKod} disabled={b.mesgul !== null}>
          Yeni kod üret
        </button>
        {E(b, {
          id: "aile-kaydet",
          rol: "stkA",
          etiket: "Aileyi kaydet",
          onClick: () => b.calistir("aile-kaydet", "stkA", "aileKaydet", [kodHash(b.aileKodu)]),
        })}
        <Hileler b={b}>
          {E(b, {
            id: "hile-aile-tekrar",
            rol: "stkB",
            etiket: "Aynı kodu tekrar kaydetmeye çalış",
            hile: true,
            onClick: () => b.calistir("hile-aile-tekrar", "stkB", "aileKaydet", [kodHash(b.aileKodu)]),
          })}
        </Hileler>
        <Neden>
          <p>
            Zincire yazılan hiçbir şey silinemez. Bu yüzden kişisel veri yerine sadece kodun parmak izi tutuluyor.
            Parmak izinden kod geri hesaplanamaz; ama kodu bilen biri, onun kayıtlı olduğunu doğrulayabilir.
          </p>
        </Neden>
      </>
    ),
  },
  // -------------------------------------------------------------------------
  {
    no: 5,
    kisaAd: "İhtiyaç talebi",
    baslik: "İhtiyaç talebi",
    icerik: (b) => {
      const talepler = ailedenTalepler(b);
      const bekleyenler = talepler.filter((t) => t.durum === 0);
      const acikKategori = talepler.find((t) => t.durum === 0 || t.durum === 1)?.kategori;
      const f = b.talepFormu;
      const secilenler = f.map((r, i) => ({ ...r, kategori: i })).filter((r) => r.secili);
      const aileHash = kodHash(b.aileKodu);
      const satirGuncelle = (i: number, deger: Partial<TalepSatiri>) =>
        b.setTalepFormu(f.map((r, k) => (k === i ? { ...r, ...deger } : r)));
      const bekleyenIdler = bekleyenler.map((t) => BigInt(t.id));
      return (
        <>
          <BaslamadiNotu b={b} />
          <p className="giris">
            Ailenin kripto cüzdanı yok, olması da beklenmiyor. Aile ihtiyaçlarını sahadaki görevliye söylüyor; görevli
            ailenin tüm ihtiyaçlarını tek seferde sisteme giriyor. Talepleri ise başka bir STK doğruluyor.
          </p>
          <table className="tablo talep-formu">
            <caption>Ailenin ihtiyaçları</caption>
            <thead>
              <tr>
                <th scope="col">Kategori</th>
                <th scope="col">Adet</th>
                <th scope="col">Aciliyet</th>
              </tr>
            </thead>
            <tbody>
              {KATEGORILER.map((k, i) => (
                <tr key={k} className={f[i].secili ? undefined : "talep-formu--pasif"}>
                  <td>
                    <label className="secim">
                      <input
                        type="checkbox"
                        checked={f[i].secili}
                        onChange={(e) => satirGuncelle(i, { secili: e.target.checked })}
                      />
                      {k}
                    </label>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      aria-label={`${k} adedi`}
                      value={f[i].adet}
                      disabled={!f[i].secili}
                      onChange={(e) => satirGuncelle(i, { adet: Math.max(0, Number(e.target.value)) })}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`${k} aciliyeti`}
                      value={f[i].aciliyet}
                      disabled={!f[i].secili}
                      onChange={(e) => satirGuncelle(i, { aciliyet: Number(e.target.value) })}
                    >
                      {[1, 2, 3].map((a) => (
                        <option key={a} value={a}>
                          {ACILIYET[a]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {E(b, {
            id: "talep-gir",
            rol: "stkA",
            etiket: secilenler.length
              ? `${secilenler.length} talebi tek işlemde gir`
              : "Talep girmek için kategori seç",
            devreDisi: secilenler.length === 0,
            onClick: () =>
              b.calistir("talep-gir", "stkA", "talepleriOlustur", [
                aileHash,
                secilenler.map((r) => r.kategori),
                secilenler.map((r) => BigInt(r.adet)),
                secilenler.map((r) => r.aciliyet),
              ]),
          })}
          {E(b, {
            id: "talep-dogrula",
            rol: "stkB",
            etiket: bekleyenler.length ? `Bekleyen ${bekleyenler.length} talebi doğrula` : "Talepleri doğrula",
            devreDisi: bekleyenler.length === 0,
            ipucu: bekleyenler.length ? undefined : "Doğrulanacak bekleyen bir talep yok.",
            onClick: () => b.calistir("talep-dogrula", "stkB", "talepleriDogrula", [bekleyenIdler]),
          })}
          <Hileler b={b}>
            {E(b, {
              id: "hile-talep-kendi",
              rol: "stkA",
              etiket: "Kendi girdiğin talepleri doğrulamaya çalış",
              hile: true,
              devreDisi: bekleyenler.length === 0,
              ipucu: bekleyenler.length ? undefined : "Önce talepleri gir; doğrulanmadan önce dene.",
              onClick: () => b.calistir("hile-talep-kendi", "stkA", "talepleriDogrula", [bekleyenIdler]),
            })}
            {E(b, {
              id: "hile-talep-ikinci",
              rol: "stkA",
              etiket:
                acikKategori !== undefined
                  ? `Açık ${KATEGORILER[acikKategori].toLowerCase()} talebi varken ikincisini açmaya çalış`
                  : "Aynı kategoride ikinci talep açmaya çalış",
              hile: true,
              devreDisi: acikKategori === undefined,
              ipucu: acikKategori === undefined ? "Önce talepleri gir." : undefined,
              onClick: () =>
                acikKategori !== undefined &&
                b.calistir("hile-talep-ikinci", "stkA", "talepOlustur", [aileHash, acikKategori, 1n, 1]),
            })}
          </Hileler>
          {talepler.length > 0 && (
            <table className="tablo">
              <caption>Bu ailenin talepleri</caption>
              <thead>
                <tr>
                  <th scope="col">Talep</th>
                  <th scope="col">İhtiyaç</th>
                  <th scope="col">Aciliyet</th>
                  <th scope="col">Durum</th>
                </tr>
              </thead>
              <tbody>
                {talepler.map((t) => (
                  <tr key={t.id}>
                    <td>#{t.id + 1}</td>
                    <td>
                      {String(t.adet)} adet {KATEGORILER[t.kategori].toLowerCase()}
                    </td>
                    <td>{ACILIYET[t.aciliyet]}</td>
                    <td>
                      <span className={`durum durum--${t.durum}`}>{TALEP_DURUMLARI[t.durum]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Neden>
            <p>
              Talepler sabit kategorilerden seçiliyor, serbest metin yok. Biri "kızımın kalp ilacı" yazsaydı bu sağlık
              bilgisi zincirde sonsuza kadar herkese açık kalırdı. Bu yüzden ilaç kategorisi bilerek yok.
            </p>
          </Neden>
        </>
      );
    },
  },
  // -------------------------------------------------------------------------
  {
    no: 6,
    kisaAd: "Teslim et",
    baslik: "Teslim et",
    icerik: (b) => {
      const talepler = ailedenTalepler(b);
      const dogrulananlar = talepler.filter((t) => t.durum === 1);
      const secili = dogrulananlar.filter((t) => !b.teslimHaric.includes(t.id));
      const seciliIdler = secili.map((t) => BigInt(t.id));
      const karsilanan = sonTalep(b, 2);
      const secimDegistir = (id: number, isaretli: boolean) =>
        b.setTeslimHaric(isaretli ? b.teslimHaric.filter((x) => x !== id) : [...b.teslimHaric, id]);
      return (
        <>
          <BaslamadiNotu b={b} />
          <p className="giris">
            Dağıtım noktasında aile kartındaki kodu gösteriyor. Dayanışma Platformu kodu sisteme giriyor ve o gün
            verilen yardımları, ailenin doğrulanmış taleplerine bağlayarak tek işlemde kaydediyor.
          </p>
          <label className="alan-tek">
            Ailenin gösterdiği kod
            <input value={b.teslimKodu} onChange={(e) => b.setTeslimKodu(e.target.value.toUpperCase())} />
          </label>
          {dogrulananlar.length > 0 ? (
            <fieldset className="teslim-listesi">
              <legend>Bu dağıtımda verilenler</legend>
              {dogrulananlar.map((t) => (
                <label key={t.id} className="secim">
                  <input
                    type="checkbox"
                    checked={!b.teslimHaric.includes(t.id)}
                    onChange={(e) => secimDegistir(t.id, e.target.checked)}
                  />
                  Talep #{t.id + 1}: {String(t.adet)} adet {KATEGORILER[t.kategori].toLowerCase()}
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="not">Teslim edilecek doğrulanmış bir talep yok. Önce talepleri girip doğrula.</p>
          )}
          {E(b, {
            id: "teslim",
            rol: "stkC",
            etiket: secili.length ? `${secili.length} talebin teslimini kaydet` : "Teslimi kaydet",
            devreDisi: secili.length === 0,
            onClick: () => b.calistir("teslim", "stkC", "teslimleriOnayla", [b.teslimKodu, seciliIdler]),
          })}
          <Hileler b={b}>
            {E(b, {
              id: "hile-teslim-kaydeden",
              rol: "stkA",
              etiket: "Kendi kaydettiğin aileye teslim yazmaya çalış",
              hile: true,
              devreDisi: secili.length === 0,
              onClick: () =>
                b.calistir("hile-teslim-kaydeden", "stkA", "teslimleriOnayla", [b.teslimKodu, seciliIdler]),
            })}
            {E(b, {
              id: "hile-teslim-hayalet",
              rol: "stkC",
              etiket: `Uydurma kodla (${UYDURMA_KOD}) teslim yazmaya çalış`,
              hile: true,
              devreDisi: secili.length === 0,
              onClick: () => b.calistir("hile-teslim-hayalet", "stkC", "teslimleriOnayla", [UYDURMA_KOD, seciliIdler]),
            })}
            {E(b, {
              id: "hile-teslim-tekrar",
              rol: "stkC",
              etiket: "Teslim edilmiş bir talebe ikinci kez teslim yazmaya çalış",
              hile: true,
              devreDisi: !karsilanan,
              ipucu: karsilanan ? undefined : "Önce teslimi kaydet.",
              onClick: () =>
                karsilanan &&
                b.calistir("hile-teslim-tekrar", "stkC", "teslimOnayla", [b.teslimKodu, BigInt(karsilanan.id)]),
            })}
          </Hileler>
          <Neden>
            <p>
              Hayalet aileye teslim yazılamaz, çünkü kod kayıtlı olmalı. Aileyi kaydeden kurum teslimi kendisi
              onaylayamaz, çünkü ikinci bir kurum gerekir. Sahte teslim için en az iki kurumun anlaşması şart.
            </p>
          </Neden>
        </>
      );
    },
  },
  // -------------------------------------------------------------------------
  {
    no: 7,
    kisaAd: "30 gün kuralı",
    baslik: "30 gün kuralı",
    icerik: (b) => {
      const karsilanan = ailedenTalepler(b).filter((t) => t.durum === 2);
      const son = karsilanan[karsilanan.length - 1];
      const kategori = son ? son.kategori : 0;
      // Henüz hiç talebi olmayan bir kategori: beklemeden kabul edilmesi gereken örnek
      const kullanilan = new Set(ailedenTalepler(b).map((t) => t.kategori));
      const bos = KATEGORILER.findIndex((_, i) => !kullanilan.has(i));
      const baska = bos >= 0 ? bos : (kategori + 1) % KATEGORILER.length;
      const aileHash = kodHash(b.aileKodu);
      return (
        <>
          <BaslamadiNotu b={b} />
          <p className="giris">
            Aynı aile aynı kategoride ancak 30 günde bir yardım alabilir. Farklı kategorilerde ise beklemesi gerekmez:
            gıda aldıktan ertesi gün battaniye isteyebilir.
          </p>
          {b.durum && (
            <p className="not">
              Zincirin saati:{" "}
              <strong>
                {new Date(Number(b.durum.zincirSaati) * 1000).toLocaleDateString("tr-TR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </strong>
              {son
                ? `. Son teslim edilen kategori: ${KATEGORILER[kategori].toLowerCase()}.`
                : ". Henüz teslim yapılmadı."}
            </p>
          )}
          {E(b, {
            id: "kural-ayni",
            rol: "stkA",
            etiket: `Yeni ${KATEGORILER[kategori].toLowerCase()} talebi gir`,
            ipucu: AG.zamanSarilabilir
              ? "30 gün dolmadan denersen zincir reddeder; ileri sardıktan sonra kabul eder."
              : "Son teslimin üzerinden 30 gün geçmediği için zincir reddetmeli.",
            onClick: () => b.calistir("kural-ayni", "stkA", "talepOlustur", [aileHash, kategori, 1n, 2]),
          })}
          {E(b, {
            id: "kural-baska",
            rol: "stkA",
            etiket: `${KATEGORILER[baska]} talebi gir`,
            ipucu: "Farklı kategori: beklemeden kabul edilir.",
            onClick: () => b.calistir("kural-baska", "stkA", "talepOlustur", [aileHash, baska, 1n, 1]),
          })}
          {AG.zamanSarilabilir ? (
            !b.saltOkunur && (
              <div className="zaman">
                <p>
                  Gerçek bir ağda 30 gün beklemek gerekirdi. Yerel test ağında zamanı ileri sarabiliyoruz; sözleşme bunu
                  gerçek bir zaman geçişi olarak görür.
                </p>
                <button
                  type="button"
                  className="dugme dugme--zaman"
                  disabled={b.mesgul !== null || !b.basladi}
                  onClick={() => b.zamanSar("sar-30", 30 * GUN)}
                >
                  {b.mesgul === "sar-30" ? "Zaman ilerliyor…" : "Zamanı 30 gün ileri sar"}
                </button>
              </div>
            )
          ) : (
            <p className="not">
              Sepolia gerçek bir ağ: zamanı ileri saramayız. Burada kuralın 30 gün dolmadan talebi reddettiğini
              görebilirsin. 30 gün sonra izin verdiğini ise otomatik testler (
              <code>test_30GunSonraAyniKategoridenTalepVeTeslim</code>) ve yerel demo gösteriyor.
            </p>
          )}
          <Neden>
            <p>
              Kural sözleşmenin içinde, yani hiçbir görevli "bu seferlik" diyerek esnetemez. Bekleme süresi yardım
              türüne göre değişebilir; gerçek bir sistemde her kategori için ayrı belirlenebilir.
            </p>
          </Neden>
        </>
      );
    },
  },
  // -------------------------------------------------------------------------
  {
    no: 8,
    kisaAd: "Kampanya sonu ve iade",
    baslik: "Kampanya sonu ve iade",
    icerik: (b) => {
      const d = b.durum;
      const kalanSaniye = d ? Number(d.sonTarih - d.zincirSaati) + 60 : 0;
      const bitti = d ? tahminiZincirSaati(d) > Number(d.sonTarih) : false;
      const tahmin = (rol: RolId) => {
        if (!d || d.toplamBagis === 0n) return null;
        const bagis = d.bagislar[rol] ?? 0n;
        return (bagis * d.kasa) / d.toplamBagis;
      };
      const ayseTahmin = tahmin("bagisciAyse");
      return (
        <>
          <BaslamadiNotu b={b} />
          <p className="giris">
            Kampanya süresi doldu ama sevkiyat aşaması hiç onaylanmadı. Kasada kalan para bağışçılara geri dönüyor:
            herkes bağışı oranında pay alıyor, kimin önce geldiği fark etmiyor.
          </p>
          {d && (
            <p className="not">
              {bitti
                ? "Kampanya süresi doldu."
                : AG.zamanSarilabilir
                  ? `Kampanyanın bitmesine ${Math.ceil(Number(d.sonTarih - d.zincirSaati) / GUN)} gün var.`
                  : "Kampanya sürüyor."}{" "}
              Kasada {eth(d.kasa)} var.
              {ayseTahmin !== null && !bitti && ` Şu an iade başlasa Ayşe ${eth(ayseTahmin)} alırdı.`}
            </p>
          )}
          <Hileler b={b} baslik="Önce: süre dolmadan dene">
            {E(b, {
              id: "hile-iade-erken",
              rol: "bagisciAyse",
              etiket: "Süre dolmadan iade almaya çalış",
              hile: true,
              devreDisi: bitti,
              onClick: () => b.calistir("hile-iade-erken", "bagisciAyse", "iadeAl"),
            })}
          </Hileler>
          {d && !AG.zamanSarilabilir && <GeriSayim durum={d} />}
          {AG.zamanSarilabilir && !b.saltOkunur && (
            <div className="zaman">
              <button
                type="button"
                className="dugme dugme--zaman"
                disabled={b.mesgul !== null || !b.basladi || bitti}
                onClick={() => b.zamanSar("sar-son", kalanSaniye)}
              >
                {b.mesgul === "sar-son" ? "Zaman ilerliyor…" : "Kampanyanın sonuna ileri sar"}
              </button>
            </div>
          )}
          {E(b, {
            id: "iade-ayse",
            rol: "bagisciAyse",
            etiket: "İade al",
            onClick: () => b.calistir("iade-ayse", "bagisciAyse", "iadeAl"),
          })}
          {E(b, {
            id: "iade-mehmet",
            rol: "bagisciMehmet",
            etiket: "İade al",
            onClick: () => b.calistir("iade-mehmet", "bagisciMehmet", "iadeAl"),
          })}
          <Hileler b={b} baslik="Sonra: iki kez almayı dene">
            {E(b, {
              id: "hile-iade-tekrar",
              rol: "bagisciAyse",
              etiket: "İkinci kez iade almaya çalış",
              hile: true,
              onClick: () => b.calistir("hile-iade-tekrar", "bagisciAyse", "iadeAl"),
            })}
          </Hileler>
          <Neden>
            <p>
              İlk tasarımda iade "ilk gelen alır" mantığıyla çalışıyordu: erken davranan tüm bağışını geri alıyor, geç
              kalan hiçbir şey alamıyordu. Şimdi ilk iade isteğinde kasa donduruluyor ve herkes{" "}
              <em>bağışı × kalan para ÷ toplam bağış</em> kadar alıyor.
            </p>
          </Neden>
        </>
      );
    },
  },
];
