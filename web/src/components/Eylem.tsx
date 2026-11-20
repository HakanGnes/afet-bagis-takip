import { AG, gezginIslem, rolBul, type RolId } from "../lib/chain";
import { ethInce, gas } from "../lib/bicim";

export type EylemSonucu =
  | { ok: true; gas?: bigint; maliyet?: bigint; hash?: string; not?: string }
  | { ok: false; sebep: string; aciklama: string };

interface Props {
  id: string;
  rol: RolId;
  etiket: string;
  onClick: () => void;
  sonuc?: EylemSonucu;
  mesgul: string | null;
  hile?: boolean;
  devreDisi?: boolean;
  ipucu?: string;
  /** İşlem sürerken düğmede görünen yazı */
  bekleyenYazi?: string;
}

export function Eylem({ id, rol, etiket, onClick, sonuc, mesgul, hile, devreDisi, ipucu, bekleyenYazi }: Props) {
  const r = rolBul(rol);
  const calisiyor = mesgul === id;
  return (
    <div className={`eylem${hile ? " eylem--hile" : ""}`}>
      <div className="eylem__satir">
        <span className={`rol rol--${r.tur === "STK" ? "stk" : rol}`} title={r.aciklama}>
          {r.ad}
        </span>
        <button
          type="button"
          className={hile ? "dugme dugme--hile" : "dugme"}
          onClick={onClick}
          disabled={mesgul !== null || devreDisi}
          aria-busy={calisiyor}
        >
          {calisiyor
            ? (bekleyenYazi ?? (AG.tur === "sepolia" ? "Zincire gönderiliyor (~15 sn)…" : "Zincire gönderiliyor…"))
            : etiket}
        </button>
      </div>
      {ipucu && !sonuc && <p className="eylem__ipucu">{ipucu}</p>}
      {sonuc && <Damga sonuc={sonuc} />}
    </div>
  );
}

function Damga({ sonuc }: { sonuc: EylemSonucu }) {
  if (sonuc.ok) {
    const link = sonuc.hash ? gezginIslem(sonuc.hash) : null;
    return (
      <div className="damga damga--ok" role="status">
        <strong>Zincire yazıldı</strong>
        {sonuc.gas !== undefined && <span>{gas(sonuc.gas)}</span>}
        {AG.tur === "sepolia" && sonuc.maliyet !== undefined && <span>ücret {ethInce(sonuc.maliyet)}</span>}
        {link && (
          <a href={link} target="_blank" rel="noreferrer">
            Etherscan'de gör
          </a>
        )}
        {sonuc.not && <span className="damga__not">{sonuc.not}</span>}
      </div>
    );
  }
  return (
    <div className="damga damga--red" role="status">
      <strong>Zincir reddetti</strong>
      <code>"{sonuc.sebep}"</code>
      {sonuc.aciklama && <span className="damga__aciklama">{sonuc.aciklama}</span>}
    </div>
  );
}
