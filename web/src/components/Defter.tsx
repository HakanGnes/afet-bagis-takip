import type { Address } from "viem";
import { AG, ROLLER, gezginIslem } from "../lib/chain";
import { eth, gas, kisa, rolAdi, zaman } from "../lib/bicim";
import { ACILIYET, KATEGORILER, type Durum, type OlayOzeti } from "../lib/kampanya";

export interface RetKaydi {
  tur: "ret";
  anahtar: string;
  blok: bigint;
  sira: number;
  rol: string;
  fonksiyon: string;
  sebep: string;
}

export type DefterKaydi = import("../lib/kampanya").ZincirOlayi | RetKaydi;

interface Props {
  sozlesme: Address | null;
  durum: Durum | null;
  kayitlar: DefterKaydi[];
  /** Paylaşılan kampanyada rollerin cüzdanları bu tarayıcınınkiler değil; hesaplar gösterilmez */
  saltOkunur?: boolean;
}

export function Defter({ sozlesme, durum, kayitlar, saltOkunur }: Props) {
  if (!sozlesme || !durum) {
    return (
      <aside className="defter" aria-label="Zincir defteri">
        <h2 className="defter__baslik">Zincir defteri</h2>
        <p className="defter__bos">
          Kampanya başlatıldığında sözleşmenin kasası, aşamaları ve her işlemin zincirdeki kaydı burada canlı olarak
          görünecek.
        </p>
      </aside>
    );
  }

  const enCok = Math.max(1, ...durum.ihtiyac.map(Number));
  const sirali = [...kayitlar].sort((a, b) => (a.blok === b.blok ? b.sira - a.sira : a.blok < b.blok ? 1 : -1));

  return (
    <aside className="defter" aria-label="Zincir defteri">
      <h2 className="defter__baslik">Zincir defteri</h2>

      <section className="defter__blok">
        <h3>Kasa</h3>
        <p className="kasa">{eth(durum.kasa)}</p>
        <p className="defter__alt">
          Toplam bağış {eth(durum.toplamBagis)}. Para yöneticide değil, sözleşmenin adresinde bekliyor.
        </p>
      </section>

      <section className="defter__blok">
        <h3>Aşamalar</h3>
        <ol className="asamalar">
          {durum.asamalar.map((a, i) => {
            const onay = Number(a.onaySayisi);
            return (
              <li key={i} className={a.tamamlandi ? "asama asama--tamam" : "asama"}>
                <span className="asama__ad">{a.aciklama}</span>
                <span className="asama__tutar">{eth(a.tutar)}</span>
                <span className="asama__onay" aria-label={`${onay} / 2 onay`}>
                  <i className={onay >= 1 ? "dolu" : ""} />
                  <i className={onay >= 2 ? "dolu" : ""} />
                </span>
                <span className="asama__durum">
                  {a.tamamlandi ? "Ödendi" : onay === 1 ? "1/2 onay" : "Onay bekliyor"}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="defter__blok">
        <h3>Karşılanmamış ihtiyaçlar</h3>
        <ul className="ihtiyac">
          {KATEGORILER.map((k, i) => (
            <li key={k}>
              <span>{k}</span>
              <span className="ihtiyac__cubuk">
                <span style={{ width: `${(Number(durum.ihtiyac[i]) / enCok) * 100}%` }} />
              </span>
              <span className="ihtiyac__sayi">{String(durum.ihtiyac[i])}</span>
            </li>
          ))}
        </ul>
        <p className="defter__alt">Toplam teslim: {String(durum.toplamTeslim)}</p>
      </section>

      {!saltOkunur && (
        <section className="defter__blok">
          <h3>Hesaplar</h3>
          <ul className="hesaplar">
            {ROLLER.map((r) => (
              <li key={r.id}>
                <span>{r.ad}</span>
                <span>{eth(durum.bakiyeler[r.id])}</span>
              </li>
            ))}
          </ul>
          <p className="defter__alt">
            {AG.tur === "yerel"
              ? "Yerel test ağı her hesaba 10.000 test ETH verir. STK'ların bakiyesi gas ödedikçe azalır."
              : "Sepolia test ETH'si. STK'ların bakiyesi her işlemde ödedikleri ücret kadar azalır."}
          </p>
        </section>
      )}

      <section className="defter__blok defter__blok--akis">
        <h3>Olay kaydı</h3>
        <p className="defter__alt">
          Zincirdeki olaylar, en yenisi üstte. Kırmızı satırlar zincirin kabul etmediği denemeler.
        </p>
        <ol className="akis">
          {sirali.map((k, i) => (
            <li
              key={k.anahtar}
              className={`${k.tur === "ret" ? "akis__satir akis__satir--ret" : "akis__satir"}${i === 0 ? " akis__satir--yeni" : ""}`}
            >
              {k.tur === "ret" ? (
                <>
                  <p>
                    {k.rol}: <em>{k.fonksiyon}</em> reddedildi
                  </p>
                  <p className="akis__meta">"{k.sebep}". Kayıt oluşmadı, para hareket etmedi.</p>
                </>
              ) : (
                <>
                  <p>{olayCumlesi(k)}</p>
                  <p className="akis__meta">
                    Blok {String(k.blok)}, {gas(k.gas)}, {zaman(k.zaman)}
                    <br />
                    {gezginIslem(k.hash) ? (
                      <a href={gezginIslem(k.hash)!} target="_blank" rel="noreferrer">
                        <code>{kisa(k.hash, 10, 6)}</code>
                      </a>
                    ) : (
                      <code title={k.hash}>{kisa(k.hash, 10, 6)}</code>
                    )}
                  </p>
                </>
              )}
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}

export function olayCumlesi(o: OlayOzeti): string {
  const a = o.args;
  switch (o.ad) {
    case "AsamaEklendi":
      return `Aşama eklendi: ${a.aciklama} (${eth(a.tutar as bigint)})`;
    case "BagisYapildi":
      return `${rolAdi(a.bagisci)} ${eth(a.miktar as bigint)} bağışladı`;
    case "AsamaOnaylandi":
      return `${rolAdi(a.stk)}, aşama ${Number(a.id) + 1} için kanıt ${kisa(String(a.kanitHash))} onayladı`;
    case "OdemeYapildi":
      return `${rolAdi(a.tedarikci)} firmasına ${eth(a.tutar as bigint)} ödendi`;
    case "IadeYapildi":
      return `${rolAdi(a.bagisci)} ${eth(a.miktar as bigint)} iade aldı`;
    case "AileKaydedildi":
      return `${rolAdi(a.stk)} bir aile kaydetti: ${kisa(String(a.kodHash))}`;
    case "TalepOlusturuldu":
      return `Talep #${Number(a.id) + 1}: ${String(a.adet)} adet ${KATEGORILER[Number(a.kategori)].toLowerCase()}, ${ACILIYET[Number(a.aciliyet)].toLowerCase()} (${rolAdi(a.stk)})`;
    case "TalepDogrulandi":
      return `${rolAdi(a.stk)} talep #${Number(a.id) + 1} doğruladı`;
    case "TalepReddedildi":
      return `${rolAdi(a.stk)} talep #${Number(a.id) + 1} reddetti`;
    case "TeslimYapildi":
      return `${rolAdi(a.stk)} talep #${Number(a.talepId) + 1} teslim etti (${KATEGORILER[Number(a.kategori)]})`;
    default:
      return o.ad;
  }
}
