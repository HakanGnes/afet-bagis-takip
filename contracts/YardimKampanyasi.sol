// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Afet bağışları için şeffaf, aşamalı yardım kampanyası
/// @notice Bağışlar sözleşmede bekler; her aşamanın parası 3 STK'dan 2'si
///         aynı kanıtı onaylayınca tedarikçiye ödenir. Son kilometrede
///         aileler kişisel veri olmadan, tek kullanımlık kodun hash'iyle izlenir.
///         Aileler ihtiyaçlarını sahadaki STK aracılığıyla talep eder; talebi
///         farklı bir STK doğrular ve teslim, doğrulanmış talebe bağlanır.
contract YardimKampanyasi {
    // ------------------------------------------------------------------
    // Veri yapıları
    // ------------------------------------------------------------------
    struct Asama {
        string aciklama;      // ör. "500 battaniye satın alma"
        uint256 tutar;        // bu aşamada tedarikçiye ödenecek miktar (wei)
        uint256 onaySayisi;
        bool tamamlandi;
        bytes32 kanitHash;    // fatura / irsaliye / fotoğrafın hash'i
    }

    struct Aile {
        address kaydeden;       // aileyi kaydeden STK
        uint256 sonTeslim;      // son teslim zamanı (0 = hiç teslim almadı)
        uint256 teslimSayisi;   // bu aileye kaç kez teslim yapıldı
    }

    // Sabit kategoriler: serbest metin yok, böylece zincire hassas veri yazılamaz
    enum Kategori { Gida, Battaniye, Hijyen, BebekMamasi, Isinma, Giyim }
    uint256 public constant KATEGORI_SAYISI = 6;

    enum TalepDurumu { Beklemede, Dogrulandi, Karsilandi, Reddedildi }

    struct Talep {
        bytes32 aileHash;         // talebi yapan ailenin kod hash'i
        Kategori kategori;
        uint256 adet;
        uint8 aciliyet;           // 1 = normal, 2 = yüksek, 3 = acil
        address olusturan;        // talebi sisteme giren STK
        address dogrulayan;       // talebi doğrulayan / reddeden STK
        TalepDurumu durum;
        uint256 olusturmaZamani;
    }

    // ------------------------------------------------------------------
    // Roller
    // ------------------------------------------------------------------
    address public yonetici;
    address payable public tedarikci;
    mapping(address => bool) public stkMi;
    uint256 public constant ESIK = 2;                 // 3 STK'dan 2'si onaylamalı

    // ------------------------------------------------------------------
    // Aşamalar ve onaylar
    // ------------------------------------------------------------------
    Asama[] public asamalar;
    mapping(uint256 => mapping(address => bool)) public onayladiMi;
    uint256 public siradakiAsama;

    // ------------------------------------------------------------------
    // Bağışlar ve iade
    // ------------------------------------------------------------------
    mapping(address => uint256) public bagislar;      // kim ne kadar bağışladı
    uint256 public sonTarih;                          // kampanyanın bitiş zamanı
    uint256 public toplamBagis;                       // tüm bağışların toplamı
    uint256 public iadeHavuzu;                        // iade başladığında kasada kalan para
    bool public iadeBasladi;

    // ------------------------------------------------------------------
    // Son kilometre: aileler ve teslimler
    // ------------------------------------------------------------------
    mapping(bytes32 => Aile) public aileler;          // kod hash'i → aile bilgisi
    uint256 public constant BEKLEME_SURESI = 30 days; // aynı kategoride iki teslim arası
    uint256 public toplamTeslim;

    // ------------------------------------------------------------------
    // İhtiyaç talepleri
    // ------------------------------------------------------------------
    Talep[] public talepler;
    mapping(bytes32 => mapping(Kategori => bool)) public acikTalepVar;          // aile + kategori → açık talep var mı
    mapping(bytes32 => mapping(Kategori => uint256)) public sonKategoriTeslimi; // aile + kategori → son teslim zamanı
    mapping(Kategori => uint256) public bekleyenTalepSayisi;                    // kategori → karşılanmamış talep sayısı

    // ------------------------------------------------------------------
    // Olaylar (şeffaflık panelinin okuyacağı kayıtlar)
    // ------------------------------------------------------------------
    event BagisYapildi(address indexed bagisci, uint256 miktar);
    event AsamaEklendi(uint256 indexed id, string aciklama, uint256 tutar);
    event AsamaOnaylandi(uint256 indexed id, address indexed stk, bytes32 kanitHash);
    event OdemeYapildi(uint256 indexed id, address tedarikci, uint256 tutar);
    event IadeYapildi(address indexed bagisci, uint256 miktar);
    event AileKaydedildi(bytes32 indexed kodHash, address indexed stk);
    event TalepOlusturuldu(uint256 indexed id, bytes32 indexed aileHash, Kategori kategori, uint256 adet, uint8 aciliyet, address stk);
    event TalepDogrulandi(uint256 indexed id, address indexed stk);
    event TalepReddedildi(uint256 indexed id, address indexed stk);
    event TeslimYapildi(bytes32 indexed kodHash, address indexed stk, uint256 indexed talepId, Kategori kategori);

    // ------------------------------------------------------------------
    // Yetki kontrolleri
    // ------------------------------------------------------------------
    modifier sadeceYonetici() {
        require(msg.sender == yonetici, "Yetkisiz");
        _;
    }

    modifier sadeceSTK() {
        require(stkMi[msg.sender], "STK degil");
        _;
    }

    constructor(address[3] memory _stkler, address payable _tedarikci, uint256 _sureDakika) {
        yonetici = msg.sender;
        tedarikci = _tedarikci;
        for (uint256 i = 0; i < 3; i++) {
            stkMi[_stkler[i]] = true;
        }
        sonTarih = block.timestamp + _sureDakika * 1 minutes;
    }

    // ------------------------------------------------------------------
    // Kampanya yönetimi
    // ------------------------------------------------------------------
    function asamaEkle(string calldata aciklama, uint256 tutar) external sadeceYonetici {
        asamalar.push(Asama(aciklama, tutar, 0, false, bytes32(0)));
        emit AsamaEklendi(asamalar.length - 1, aciklama, tutar);
    }

    // ------------------------------------------------------------------
    // Bağış
    // ------------------------------------------------------------------
    function bagisYap() external payable {
        require(block.timestamp <= sonTarih, "Kampanya sona erdi");
        require(msg.value > 0, "Bagis 0 olamaz");
        bagislar[msg.sender] += msg.value;
        toplamBagis += msg.value;
        emit BagisYapildi(msg.sender, msg.value);
    }

    // ------------------------------------------------------------------
    // Aşama onayı ve ödeme (2-of-3 çoklu imza)
    // ------------------------------------------------------------------
    function onayla(uint256 id, bytes32 kanitHash) external sadeceSTK {
        require(block.timestamp <= sonTarih, "Kampanya sona erdi");
        require(id < asamalar.length, "Asama yok");
        require(id == siradakiAsama, "Sira bu asamada degil");
        require(!onayladiMi[id][msg.sender], "Zaten onayladin");

        Asama storage a = asamalar[id];

        // İlk onaylayan kanıtı belirler, diğerleri AYNI kanıtı onaylamalı
        if (a.onaySayisi == 0) {
            a.kanitHash = kanitHash;
        } else {
            require(a.kanitHash == kanitHash, "Kanit uyusmuyor");
        }

        onayladiMi[id][msg.sender] = true;
        a.onaySayisi++;
        emit AsamaOnaylandi(id, msg.sender, kanitHash);

        if (a.onaySayisi >= ESIK) {
            require(address(this).balance >= a.tutar, "Yetersiz bakiye");
            // Önce durumu güncelle, SONRA para gönder (reentrancy koruması)
            a.tamamlandi = true;
            siradakiAsama++;
            (bool ok, ) = tedarikci.call{value: a.tutar}("");
            require(ok, "Odeme basarisiz");
            emit OdemeYapildi(id, tedarikci, a.tutar);
        }
    }

    // ------------------------------------------------------------------
    // Orantılı iade
    // ------------------------------------------------------------------
    function iadeAl() external {
        require(block.timestamp > sonTarih, "Sure dolmadi");
        require(asamalar.length == 0 || siradakiAsama < asamalar.length, "Kampanya tamamlandi");

        uint256 bagis = bagislar[msg.sender];
        require(bagis > 0, "Iade edilecek bagis yok");

        // İlk iade isteğinde kasadaki parayı "dondur"
        if (!iadeBasladi) {
            iadeBasladi = true;
            iadeHavuzu = address(this).balance;
        }

        // Herkes bağışı oranında pay alır; sıranın önemi yok
        uint256 miktar = (bagis * iadeHavuzu) / toplamBagis;

        bagislar[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: miktar}("");
        require(ok, "Iade basarisiz");
        emit IadeYapildi(msg.sender, miktar);
    }

    // ------------------------------------------------------------------
    // Son kilometre: aile kaydı ve teslim
    // ------------------------------------------------------------------

    /// @notice STK bir aileyi kaydeder. Zincire sadece kodun hash'i yazılır,
    ///         kişisel veri yazılmaz.
    function aileKaydet(bytes32 kodHash) external sadeceSTK {
        require(aileler[kodHash].kaydeden == address(0), "Aile zaten kayitli");
        aileler[kodHash].kaydeden = msg.sender;
        emit AileKaydedildi(kodHash, msg.sender);
    }

    // ------------------------------------------------------------------
    // İhtiyaç talepleri
    // ------------------------------------------------------------------

    /// @notice Sahadaki STK, ailenin tek bir ihtiyacını sisteme girer.
    function talepOlustur(bytes32 aileHash, Kategori kategori, uint256 adet, uint8 aciliyet)
        external
        sadeceSTK
        returns (uint256 id)
    {
        id = _talepOlustur(aileHash, kategori, adet, aciliyet);
    }

    /// @notice Bir ailenin birden fazla kategorideki ihtiyacını tek işlemde girer
    ///         (ör. aynı anda gıda, battaniye ve hijyen). Listelerden biri hatalıysa
    ///         işlemin tamamı geri alınır.
    function talepleriOlustur(
        bytes32 aileHash,
        Kategori[] calldata kategoriler,
        uint256[] calldata adetler,
        uint8[] calldata aciliyetler
    ) external sadeceSTK returns (uint256[] memory idler) {
        require(kategoriler.length > 0, "Talep listesi bos");
        require(
            kategoriler.length == adetler.length && adetler.length == aciliyetler.length,
            "Liste uzunluklari farkli"
        );
        idler = new uint256[](kategoriler.length);
        for (uint256 i = 0; i < kategoriler.length; i++) {
            idler[i] = _talepOlustur(aileHash, kategoriler[i], adetler[i], aciliyetler[i]);
        }
    }

    function _talepOlustur(bytes32 aileHash, Kategori kategori, uint256 adet, uint8 aciliyet)
        private
        returns (uint256 id)
    {
        require(aileler[aileHash].kaydeden != address(0), "Kayitsiz aile");
        require(adet > 0, "Adet 0 olamaz");
        require(aciliyet >= 1 && aciliyet <= 3, "Aciliyet 1-3 olmali");
        require(!acikTalepVar[aileHash][kategori], "Bu kategoride acik talep var");

        // 30 gün kuralı kategori bazında: gıda aldıktan sonra battaniye istenebilir,
        // ama 30 gün dolmadan ikinci gıda istenemez
        uint256 sonTeslim = sonKategoriTeslimi[aileHash][kategori];
        require(sonTeslim == 0 || block.timestamp >= sonTeslim + BEKLEME_SURESI, "30 gun dolmadi");

        id = talepler.length;
        talepler.push(
            Talep({
                aileHash: aileHash,
                kategori: kategori,
                adet: adet,
                aciliyet: aciliyet,
                olusturan: msg.sender,
                dogrulayan: address(0),
                durum: TalepDurumu.Beklemede,
                olusturmaZamani: block.timestamp
            })
        );

        acikTalepVar[aileHash][kategori] = true;
        bekleyenTalepSayisi[kategori]++;
        emit TalepOlusturuldu(id, aileHash, kategori, adet, aciliyet, msg.sender);
    }

    /// @notice Talebi, onu girenden FARKLI bir STK doğrular.
    function talepDogrula(uint256 id) external sadeceSTK {
        _talepDogrula(id);
    }

    /// @notice Birden fazla talebi tek işlemde doğrular.
    function talepleriDogrula(uint256[] calldata idler) external sadeceSTK {
        require(idler.length > 0, "Talep listesi bos");
        for (uint256 i = 0; i < idler.length; i++) {
            _talepDogrula(idler[i]);
        }
    }

    function _talepDogrula(uint256 id) private {
        Talep storage t = _bekleyenTalep(id);
        t.durum = TalepDurumu.Dogrulandi;
        t.dogrulayan = msg.sender;
        emit TalepDogrulandi(id, msg.sender);
    }

    /// @notice Talebi, onu girenden FARKLI bir STK reddeder. Aile aynı
    ///         kategoride yeniden talep açabilir.
    function talepReddet(uint256 id) external sadeceSTK {
        Talep storage t = _bekleyenTalep(id);
        t.durum = TalepDurumu.Reddedildi;
        t.dogrulayan = msg.sender;
        acikTalepVar[t.aileHash][t.kategori] = false;
        bekleyenTalepSayisi[t.kategori]--;
        emit TalepReddedildi(id, msg.sender);
    }

    function _bekleyenTalep(uint256 id) private view returns (Talep storage t) {
        require(id < talepler.length, "Talep yok");
        t = talepler[id];
        require(t.durum == TalepDurumu.Beklemede, "Talep beklemede degil");
        require(t.olusturan != msg.sender, "Olusturan STK dogrulayamaz");
    }

    // ------------------------------------------------------------------
    // Teslim
    // ------------------------------------------------------------------

    /// @notice Dağıtım noktasında, aileyi kaydedenden FARKLI bir STK
    ///         ailenin gösterdiği kodu girer ve teslimi doğrulanmış talebe bağlar.
    function teslimOnayla(string calldata kod, uint256 talepId) external sadeceSTK {
        (bytes32 kodHash, Aile storage aile) = _teslimEdilecekAile(kod);
        _teslimEt(kodHash, aile, talepId);
    }

    /// @notice Aynı aileye ait birden fazla talebi tek seferde teslim eder
    ///         (ör. gıda, battaniye ve hijyen aynı dağıtımda).
    function teslimleriOnayla(string calldata kod, uint256[] calldata talepIdler) external sadeceSTK {
        require(talepIdler.length > 0, "Talep listesi bos");
        (bytes32 kodHash, Aile storage aile) = _teslimEdilecekAile(kod);
        for (uint256 i = 0; i < talepIdler.length; i++) {
            _teslimEt(kodHash, aile, talepIdler[i]);
        }
    }

    function _teslimEdilecekAile(string calldata kod) private view returns (bytes32 kodHash, Aile storage aile) {
        kodHash = keccak256(abi.encodePacked(kod));
        aile = aileler[kodHash];

        // 1) Kod kayıtlı mı? (hayalet aile engeli)
        require(aile.kaydeden != address(0), "Kayitsiz kod");

        // 2) Teslim eden, kaydedenden farklı mı? (tek kurumun hilesi engeli)
        require(aile.kaydeden != msg.sender, "Kaydeden STK teslim edemez");
    }

    function _teslimEt(bytes32 kodHash, Aile storage aile, uint256 talepId) private {
        // 3) Talep bu aileye mi ait ve doğrulanmış mı?
        require(talepId < talepler.length, "Talep yok");
        Talep storage t = talepler[talepId];
        require(t.aileHash == kodHash, "Talep bu aileye ait degil");
        require(t.durum == TalepDurumu.Dogrulandi, "Talep dogrulanmamis");

        // 4) Kayıtları güncelle
        t.durum = TalepDurumu.Karsilandi;
        acikTalepVar[kodHash][t.kategori] = false;
        bekleyenTalepSayisi[t.kategori]--;
        sonKategoriTeslimi[kodHash][t.kategori] = block.timestamp;

        aile.sonTeslim = block.timestamp;
        aile.teslimSayisi++;
        toplamTeslim++;

        // 5) Şeffaflık kaydı
        emit TeslimYapildi(kodHash, msg.sender, talepId, t.kategori);
    }

    // ------------------------------------------------------------------
    // Okuma yardımcıları
    // ------------------------------------------------------------------

    /// @notice Bir kodun hash'ini hesaplar (aile kaydı sırasında kullanılır).
    function kodHashHesapla(string calldata kod) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(kod));
    }

    /// @notice Talebin tüm bilgilerini tek seferde döndürür (arayüz için).
    function talepGetir(uint256 id) external view returns (Talep memory) {
        require(id < talepler.length, "Talep yok");
        return talepler[id];
    }

    function talepSayisi() external view returns (uint256) {
        return talepler.length;
    }

    /// @notice Kategori bazında karşılanmamış talep sayıları
    ///         (sıra: Gida, Battaniye, Hijyen, BebekMamasi, Isinma, Giyim).
    function ihtiyacTablosu() external view returns (uint256[KATEGORI_SAYISI] memory sayilar) {
        for (uint256 i = 0; i < KATEGORI_SAYISI; i++) {
            sayilar[i] = bekleyenTalepSayisi[Kategori(i)];
        }
    }

    function asamaSayisi() external view returns (uint256) {
        return asamalar.length;
    }

    function bakiye() external view returns (uint256) {
        return address(this).balance;
    }
}
