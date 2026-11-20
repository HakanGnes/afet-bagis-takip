import { useCallback, useEffect, useRef, useState } from "react";
import { isAddress, type Address } from "viem";
import { Defter, olayCumlesi, type DefterKaydi } from "./components/Defter";
import type { EylemSonucu } from "./components/Eylem";
import { AG, agKontrol, gezginAdres, rolBul, type RolId } from "./lib/chain";
import { kisa, zaman } from "./lib/bicim";
import {
  VARSAYILAN_BAGIS,
  VARSAYILAN_SURE_DAKIKA,
  aileKoduUret,
  bakiyeleriOku,
  durumOku,
  islemGonder,
  kampanyaKur,
  olaylariGetir,
  rollereDagit,
  sozlesmeVarMi,
  yoneticiMi,
  zamaniIleriSar,
  type Durum,
  type ZincirOlayi,
} from "./lib/kampanya";
import { VARSAYILAN_TALEP_FORMU, adimlariGetir, type Baglam, type TalepFormu } from "./steps";

interface Sozlesme {
  adres: Address;
  baslangicBlogu: string; // depolamada metin olarak
}

interface Kayit {
  sozlesme: Sozlesme | null;
  aileKodu: string | null;
  adim: number;
  hileGoster?: boolean;
}

const KAYIT_ANAHTARI = `afet-bagis-demo-${AG.tur}-${AG.chain.id}`;
const ADIMLAR = adimlariGetir();

function kayitOku(): Kayit {
  try {
    const ham = localStorage.getItem(KAYIT_ANAHTARI);
    if (ham) return JSON.parse(ham);
  } catch {
    /* tarayıcı depolaması kullanılamıyorsa baştan başlar */
  }
  return { sozlesme: null, aileKodu: null, adim: 0 };
}

function kayitYaz(v: Kayit) {
  try {
    localStorage.setItem(KAYIT_ANAHTARI, JSON.stringify(v));
  } catch {
    /* önemli değil */
  }
}

/** ?sozlesme=0x…&blok=123 ile paylaşılan bir kampanyayı açar. */
function linktekiSozlesme(): Sozlesme | null {
  const p = new URLSearchParams(location.search);
  const a = p.get("sozlesme");
  const b = p.get("blok");
  if (a && isAddress(a) && b && /^\d+$/.test(b)) return { adres: a, baslangicBlogu: b };
  return null;
}

function hataMetni(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/insufficient funds|exceeds the balance|gas required exceeds/i.test(m)) {
    return "Cüzdanda işlem ücretini karşılayacak kadar test ETH'si yok. Hazırlık adımından bakiyeleri kontrol et.";
  }
  return m.split("\n")[0];
}

export default function App() {
  const ilk = useRef(kayitOku());
  const [ag, setAg] = useState<"kontrol" | "hazir" | "yok">("kontrol");
  const [sozlesme, setSozlesme] = useState<Sozlesme | null>(null);
  const [saltOkunur, setSaltOkunur] = useState(false);
  const [durum, setDurum] = useState<Durum | null>(null);
  const [bakiyeler, setBakiyeler] = useState<Record<RolId, bigint> | null>(null);
  const [olaylar, setOlaylar] = useState<ZincirOlayi[]>([]);
  const [retler, setRetler] = useState<DefterKaydi[]>([]);
  const [sonuclar, setSonuclar] = useState<Record<string, EylemSonucu>>({});
  const [mesgul, setMesgul] = useState<string | null>(null);
  const [ilerleme, setIlerleme] = useState<string | null>(null);
  const [adim, setAdim] = useState(Math.min(ilk.current.adim ?? 0, ADIMLAR.length - 1));
  const [hileGoster, setHileGoster] = useState(ilk.current.hileGoster ?? true);
  const [aileKodu, setAileKodu] = useState(ilk.current.aileKodu ?? aileKoduUret());
  const [teslimKodu, setTeslimKodu] = useState(aileKodu);
  const [belge, setBelge] = useState("fatura-2026-0412.pdf");
  const [miktarlar, setMiktarlar] = useState({ ayse: VARSAYILAN_BAGIS, mehmet: VARSAYILAN_BAGIS });
  const [talepFormu, setTalepFormu] = useState<TalepFormu>(VARSAYILAN_TALEP_FORMU);
  const [teslimHaric, setTeslimHaric] = useState<number[]>([]);
  const [sureDakika, setSureDakika] = useState(VARSAYILAN_SURE_DAKIKA);
  const [hata, setHata] = useState<string | null>(null);
  const [kopyalandi, setKopyalandi] = useState(false);

  // ---------------------------------------------------------------- yenile
  const yenile = useCallback(async (s: Sozlesme | null) => {
    setBakiyeler(await bakiyeleriOku());
    if (!s) return;
    const [d, o] = await Promise.all([durumOku(s.adres), olaylariGetir(s.adres, BigInt(s.baslangicBlogu))]);
    setDurum(d);
    setOlaylar(o);
  }, []);

  // ---------------------------------------------------------------- açılış
  const baglan = useCallback(async () => {
    setAg("kontrol");
    if (!(await agKontrol())) {
      setAg("yok");
      return;
    }
    const linkten = linktekiSozlesme();
    const aday = linkten ?? ilk.current.sozlesme;
    if (aday && (await sozlesmeVarMi(aday.adres))) {
      setSozlesme(aday);
      setSaltOkunur(!(await yoneticiMi(aday.adres)));
      await yenile(aday);
    } else {
      // Yerel ağ yeniden başlatılmış ya da link geçersiz: eski sözleşme yok
      setSozlesme(null);
      await yenile(null);
    }
    setAg("hazir");
  }, [yenile]);

  useEffect(() => {
    baglan();
  }, [baglan]);

  useEffect(() => {
    // Paylaşılan bir kampanyaya bakarken kendi kaydımızın üzerine yazmayalım
    if (saltOkunur) return;
    kayitYaz({ sozlesme, aileKodu, adim, hileGoster });
  }, [sozlesme, aileKodu, adim, hileGoster, saltOkunur]);

  // ---------------------------------------------------------------- eylemler
  const calistir = useCallback(
    async (id: string, rol: RolId, fonksiyon: string, args: readonly unknown[] = [], deger?: bigint) => {
      if (!sozlesme) return;
      setMesgul(id);
      setHata(null);
      try {
        const s = await islemGonder(sozlesme.adres, rol, fonksiyon, args, deger);
        setSonuclar((o) => ({
          ...o,
          [id]: s.ok
            ? {
                ok: true,
                gas: s.gas,
                maliyet: s.maliyet,
                hash: s.hash,
                not: s.olaylar.map(olayCumlesi).join(". ") || undefined,
              }
            : s,
        }));
        if (!s.ok) {
          const blok = olaylar.at(-1)?.blok ?? 0n;
          setRetler((r) => [
            ...r,
            {
              tur: "ret",
              anahtar: `ret-${Date.now()}`,
              blok,
              sira: 10_000 + r.length,
              rol: rolBul(rol).ad,
              fonksiyon,
              sebep: s.sebep,
            },
          ]);
        }
        await yenile(sozlesme);
      } catch (e) {
        setHata(hataMetni(e));
      } finally {
        setMesgul(null);
      }
    },
    [sozlesme, olaylar, yenile],
  );

  const kampanyaBaslat = useCallback(async () => {
    setMesgul("kur");
    setHata(null);
    try {
      const { adres, baslangicBlogu } = await kampanyaKur(sureDakika, setIlerleme);
      const s = { adres, baslangicBlogu: String(baslangicBlogu) };
      setSozlesme(s);
      setSaltOkunur(false);
      setSonuclar({ kur: { ok: true, not: `Sözleşme adresi ${kisa(adres)}` } });
      setRetler([]);
      history.replaceState(null, "", location.pathname); // linkte eski kampanya kalmasın
      await yenile(s);
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setMesgul(null);
      setIlerleme(null);
    }
  }, [sureDakika, yenile]);

  const dagit = useCallback(async () => {
    setMesgul("dagit");
    setHata(null);
    try {
      const n = await rollereDagit();
      setSonuclar((o) => ({
        ...o,
        dagit: { ok: true, not: n === 0 ? "Tüm rollerin bakiyesi zaten yeterli." : `${n} role test ETH gönderildi.` },
      }));
      await yenile(sozlesme);
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setMesgul(null);
    }
  }, [sozlesme, yenile]);

  const zamanSar = useCallback(
    async (id: string, saniye: number) => {
      setMesgul(id);
      setHata(null);
      try {
        await zamaniIleriSar(saniye);
        await yenile(sozlesme);
      } catch (e) {
        setHata(hataMetni(e));
      } finally {
        setMesgul(null);
      }
    },
    [sozlesme, yenile],
  );

  const sifirla = () => {
    history.replaceState(null, "", location.pathname);
    setSozlesme(null);
    setSaltOkunur(false);
    setDurum(null);
    setOlaylar([]);
    setRetler([]);
    setSonuclar({});
    setTeslimHaric([]);
    setTalepFormu(VARSAYILAN_TALEP_FORMU);
    setAdim(0);
    const k = aileKoduUret();
    setAileKodu(k);
    setTeslimKodu(k);
  };

  const yeniKod = () => {
    const k = aileKoduUret();
    setAileKodu(k);
    setTeslimKodu(k);
  };

  const paylasimLinki = sozlesme
    ? `${location.origin}${location.pathname}?sozlesme=${sozlesme.adres}&blok=${sozlesme.baslangicBlogu}`
    : null;

  const linkKopyala = async () => {
    if (!paylasimLinki) return;
    try {
      await navigator.clipboard.writeText(paylasimLinki);
      setKopyalandi(true);
      setTimeout(() => setKopyalandi(false), 2000);
    } catch {
      /* pano izni yoksa link zaten ekranda görünüyor */
    }
  };

  // ---------------------------------------------------------------- görünüm
  if (ag !== "hazir") {
    return <AgEkrani durum={ag} tekrarDene={baglan} />;
  }

  const baglam: Baglam = {
    durum,
    bakiyeler,
    basladi: sozlesme !== null,
    saltOkunur,
    hileGoster,
    mesgul,
    ilerleme,
    sonuclar,
    calistir,
    kampanyaBaslat,
    dagit,
    bakiyeYenile: () => {
      yenile(sozlesme).catch((e) => setHata(hataMetni(e)));
    },
    zamanSar,
    sureDakika,
    setSureDakika,
    aileKodu,
    yeniKod,
    belge,
    setBelge,
    miktarlar,
    setMiktar: (kim, v) => setMiktarlar((m) => ({ ...m, [kim]: v })),
    talepFormu,
    setTalepFormu,
    teslimHaric,
    setTeslimHaric,
    teslimKodu,
    setTeslimKodu,
  };

  const aktif = ADIMLAR[adim];
  const sozlesmeLinki = sozlesme ? gezginAdres(sozlesme.adres) : null;

  return (
    <div className="sayfa">
      <header className="ust">
        <div className="ust__marka">
          <h1>Afet bağışı takip</h1>
          <p>Bağıştan teslimata her adımı zincirde izlenen bir yardım kampanyası</p>
        </div>
        <dl className="ust__bilgi">
          <div>
            <dt>Ağ</dt>
            <dd>{AG.ad}</dd>
          </div>
          <div>
            <dt>Zincirin saati</dt>
            <dd>{durum ? zaman(durum.zincirSaati) : "—"}</dd>
          </div>
          <div>
            <dt>Sözleşme</dt>
            <dd>
              {sozlesme ? (
                sozlesmeLinki ? (
                  <a href={sozlesmeLinki} target="_blank" rel="noreferrer">
                    <code>{kisa(sozlesme.adres)}</code>
                  </a>
                ) : (
                  <code title={sozlesme.adres}>{kisa(sozlesme.adres)}</code>
                )
              ) : (
                "Henüz yüklenmedi"
              )}
            </dd>
          </div>
        </dl>
        <div className="ust__kontroller">
          {!saltOkunur && (
            <label className="anahtar">
              <input
                type="checkbox"
                role="switch"
                checked={hileGoster}
                onChange={(e) => setHileGoster(e.target.checked)}
              />
              <span className="anahtar__ray" aria-hidden="true" />
              Hile denemelerini göster
            </label>
          )}
          <button type="button" className="dugme dugme--ikincil" onClick={sifirla} disabled={mesgul !== null}>
            {saltOkunur ? "Kendi demonu başlat" : "Demoyu sıfırla"}
          </button>
        </div>
      </header>

      {AG.tur === "sepolia" && sozlesme && (
        <div className={saltOkunur ? "serit serit--salt" : "serit"}>
          {saltOkunur ? (
            <p>
              <strong>Salt okunur görünüm.</strong> Sepolia'daki gerçek bir kampanyaya bakıyorsun. İşlemleri sadece
              kampanyayı başlatan kişi yapabilir; her kaydı Etherscan'de bağımsız olarak doğrulayabilirsin.
            </p>
          ) : (
            <p>
              Bu kampanyayı başkalarıyla paylaş: link açan herkes defteri salt okunur olarak görür.{" "}
              <button type="button" className="metin-dugme" onClick={linkKopyala}>
                {kopyalandi ? "Kopyalandı" : "Linki kopyala"}
              </button>
            </p>
          )}
        </div>
      )}

      <div className="govde">
        <nav className="ray" aria-label="Senaryo adımları">
          <ol>
            {ADIMLAR.map((a, i) => (
              <li key={a.kisaAd}>
                <button
                  type="button"
                  className={i === adim ? "ray__adim ray__adim--aktif" : "ray__adim"}
                  aria-current={i === adim ? "step" : undefined}
                  onClick={() => setAdim(i)}
                >
                  <span className="ray__no">{a.no}</span>
                  <span>{a.kisaAd}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <main className={saltOkunur ? "sahne sahne--salt" : "sahne"}>
          <p className="sahne__sayac">
            {aktif.no === 0 ? "Başlamadan önce" : `Adım ${aktif.no} / ${ADIMLAR.filter((a) => a.no > 0).length}`}
          </p>
          {aktif.baslik && <h2 className="sahne__baslik">{aktif.baslik}</h2>}
          {hata && (
            <p className="not not--hata" role="alert">
              İşlem tamamlanamadı: {hata}
              {AG.tur === "yerel" && (
                <>
                  {" "}
                  Yerel ağın (<code>npx hardhat node</code>) hâlâ çalıştığını kontrol et.
                </>
              )}
            </p>
          )}
          <div className="sahne__icerik">{aktif.icerik(baglam)}</div>
          <div className="sahne__gezinti">
            <button
              type="button"
              className="dugme dugme--ikincil"
              disabled={adim === 0}
              onClick={() => setAdim((a) => a - 1)}
            >
              Önceki adım
            </button>
            {adim < ADIMLAR.length - 1 && (
              <button type="button" className="dugme dugme--ileri" onClick={() => setAdim((a) => a + 1)}>
                Sonraki adım: {ADIMLAR[adim + 1].kisaAd}
              </button>
            )}
          </div>
        </main>

        <Defter
          sozlesme={sozlesme?.adres ?? null}
          durum={durum}
          kayitlar={[...olaylar, ...retler]}
          saltOkunur={saltOkunur}
        />
      </div>
    </div>
  );
}

function AgEkrani({ durum, tekrarDene }: { durum: "kontrol" | "yok"; tekrarDene: () => void }) {
  return (
    <div className="ag-ekrani">
      <h1>Afet bağışı takip</h1>
      {durum === "kontrol" ? (
        <p>{AG.ad} ağına bağlanılıyor…</p>
      ) : AG.tur === "yerel" ? (
        <>
          <p>
            Yerel blokzinciri çalışmıyor. Proje klasöründe ayrı bir terminal aç ve şu komutu çalıştır, sonra tekrar
            dene:
          </p>
          <pre>npx hardhat node</pre>
          <button type="button" className="dugme" onClick={tekrarDene}>
            Tekrar dene
          </button>
        </>
      ) : (
        <>
          <p>
            Sepolia ağına ulaşılamadı. İnternet bağlantını kontrol et. Sorun sürerse <code>web/.env.sepolia</code>{" "}
            dosyasında <code>VITE_RPC_URL</code> ile başka bir RPC adresi dene.
          </p>
          <button type="button" className="dugme" onClick={tekrarDene}>
            Tekrar dene
          </button>
        </>
      )}
    </div>
  );
}
