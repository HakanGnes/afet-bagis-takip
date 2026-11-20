// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {YardimKampanyasi} from "./YardimKampanyasi.sol";

contract YardimKampanyasiTest is Test {
    YardimKampanyasi kampanya;

    // Roller (Remix'teki hesapların karşılığı)
    address stk1 = address(0x1001);
    address stk2 = address(0x1002);
    address stk3 = address(0x1003);
    address tedarikci = address(0x2001);
    address bagisci1 = address(0x3001);
    address bagisci2 = address(0x3002);

    // Gerçek bir dosyanın hash'i gibi davranan kanıtlar
    bytes32 constant KANIT = keccak256("fatura-001.pdf");
    bytes32 constant SAHTE_KANIT = keccak256("sahte-fatura.pdf");

    // Ailelere verilen tek kullanımlık kodlar
    string constant AILE_KODU = "K7X-92QM-4TB1";
    bytes32 constant AILE_HASH = keccak256(abi.encodePacked("K7X-92QM-4TB1"));

    // Her testten önce otomatik çalışır: temiz bir kampanya kurar
    function setUp() public {
        kampanya = new YardimKampanyasi([stk1, stk2, stk3], payable(tedarikci), 60);
        kampanya.asamaEkle("Battaniye satin alma", 1 ether);
        kampanya.asamaEkle("Bolgeye sevkiyat", 0.5 ether);
        vm.deal(bagisci1, 10 ether);
        vm.deal(bagisci2, 10 ether);
    }

    // ---------- Yardımcı fonksiyonlar ----------
    function _bagisYap(address kim, uint256 miktar) internal {
        vm.prank(kim);
        kampanya.bagisYap{value: miktar}();
    }

    function _onayla(address stk, uint256 id, bytes32 kanit) internal {
        vm.prank(stk);
        kampanya.onayla(id, kanit);
    }

    function _sureyiBitir() internal {
        vm.warp(block.timestamp + 61 minutes);
    }

    function _aileKaydet(address stk, bytes32 kodHash) internal {
        vm.prank(stk);
        kampanya.aileKaydet(kodHash);
    }

    function _teslimEt(address stk, string memory kod, uint256 talepId) internal {
        vm.prank(stk);
        kampanya.teslimOnayla(kod, talepId);
    }

    function _talepOlustur(address stk, bytes32 aileHash, YardimKampanyasi.Kategori kategori)
        internal
        returns (uint256 id)
    {
        vm.prank(stk);
        id = kampanya.talepOlustur(aileHash, kategori, 2, 2);
    }

    /// @dev stk1 aileyi kaydeder ve talebi girer, stk2 doğrular
    function _dogrulanmisTalep(YardimKampanyasi.Kategori kategori) internal returns (uint256 id) {
        (address kaydeden, , ) = kampanya.aileler(AILE_HASH);
        if (kaydeden == address(0)) {
            _aileKaydet(stk1, AILE_HASH);
        }
        id = _talepOlustur(stk1, AILE_HASH, kategori);
        vm.prank(stk2);
        kampanya.talepDogrula(id);
    }

    function _durum(uint256 id) internal view returns (YardimKampanyasi.TalepDurumu) {
        return kampanya.talepGetir(id).durum;
    }

    // =================================================================
    // 1. BAĞIŞ VE AŞAMA ONAYI
    // =================================================================
    function test_BagisKaydedilir() public {
        _bagisYap(bagisci1, 1 ether);
        assertEq(kampanya.bagislar(bagisci1), 1 ether);
        assertEq(kampanya.toplamBagis(), 1 ether);
        assertEq(address(kampanya).balance, 1 ether);
    }

    function test_TekOnayYetmez_IkinciOnaydaOdemeYapilir() public {
        _bagisYap(bagisci1, 2 ether);

        _onayla(stk1, 0, KANIT);
        assertEq(tedarikci.balance, 0);            // tek onay: para gitmedi

        _onayla(stk2, 0, KANIT);
        assertEq(tedarikci.balance, 1 ether);      // eşik doldu: ödendi
        assertEq(kampanya.siradakiAsama(), 1);
    }

    function test_RevertWhen_YoneticiOnaylamayaCalisir() public {
        _bagisYap(bagisci1, 2 ether);
        vm.expectRevert(bytes("STK degil"));
        kampanya.onayla(0, KANIT);                 // yönetici = bu test sözleşmesi
    }

    function test_RevertWhen_AyniSTKIkiKezOnaylar() public {
        _onayla(stk1, 0, KANIT);
        vm.expectRevert(bytes("Zaten onayladin"));
        _onayla(stk1, 0, KANIT);
    }

    function test_RevertWhen_KanitlarUyusmaz() public {
        _onayla(stk1, 0, KANIT);
        vm.expectRevert(bytes("Kanit uyusmuyor"));
        _onayla(stk2, 0, SAHTE_KANIT);
    }

    function test_RevertWhen_AsamaAtlanir() public {
        vm.expectRevert(bytes("Sira bu asamada degil"));
        _onayla(stk1, 1, KANIT);                   // 0 bitmeden 1 onaylanamaz
    }

    // =================================================================
    // 2. SÜRE VE İADE
    // =================================================================
    function test_RevertWhen_SureDolmadanIade() public {
        _bagisYap(bagisci1, 1 ether);
        vm.expectRevert(bytes("Sure dolmadi"));
        vm.prank(bagisci1);
        kampanya.iadeAl();
    }

    function test_RevertWhen_SureDolduktanSonraBagis() public {
        _sureyiBitir();
        vm.expectRevert(bytes("Kampanya sona erdi"));
        _bagisYap(bagisci1, 1 ether);
    }

    function test_RevertWhen_IkiKezIade() public {
        _bagisYap(bagisci1, 1 ether);
        _sureyiBitir();
        vm.prank(bagisci1);
        kampanya.iadeAl();
        vm.expectRevert(bytes("Iade edilecek bagis yok"));
        vm.prank(bagisci1);
        kampanya.iadeAl();
    }

    function test_OrantiliIade_SiraFarketmez() public {
        _bagisYap(bagisci1, 1 ether);
        _bagisYap(bagisci2, 1 ether);
        _onayla(stk1, 0, KANIT);
        _onayla(stk2, 0, KANIT);                   // 1 ether tedarikçiye gitti
        _sureyiBitir();

        vm.prank(bagisci1);
        kampanya.iadeAl();
        vm.prank(bagisci2);
        kampanya.iadeAl();

        // İkisi de 0.5 ether geri aldı: 10 - 1 + 0.5 = 9.5
        assertEq(bagisci1.balance, 9.5 ether);
        assertEq(bagisci2.balance, 9.5 ether);
    }

    function test_AsamasizKampanyadaParaKilitlenmez() public {
        YardimKampanyasi bos = new YardimKampanyasi([stk1, stk2, stk3], payable(tedarikci), 60);

        vm.prank(bagisci1);
        bos.bagisYap{value: 1 ether}();
        _sureyiBitir();
        vm.prank(bagisci1);
        bos.iadeAl();

        assertEq(bagisci1.balance, 10 ether);      // parasının tamamı geri geldi
    }

    // =================================================================
    // 3. SON KİLOMETRE: AİLE KAYDI VE TESLİM
    // =================================================================
    function test_AileKaydedilir() public {
        _aileKaydet(stk1, AILE_HASH);
        (address kaydeden, uint256 sonTeslim, uint256 teslimSayisi) = kampanya.aileler(AILE_HASH);
        assertEq(kaydeden, stk1);
        assertEq(sonTeslim, 0);
        assertEq(teslimSayisi, 0);
    }

    function test_KodHashHesapla_TestteHesaplananlaAyni() public view {
        assertEq(kampanya.kodHashHesapla(AILE_KODU), AILE_HASH);
    }

    function test_RevertWhen_AyniAileIkiKezKaydedilir() public {
        _aileKaydet(stk1, AILE_HASH);
        vm.expectRevert(bytes("Aile zaten kayitli"));
        _aileKaydet(stk2, AILE_HASH);
    }

    function test_RevertWhen_STKOlmayanAileKaydeder() public {
        vm.expectRevert(bytes("STK degil"));
        _aileKaydet(bagisci1, AILE_HASH);
    }

    // =================================================================
    // 4. İHTİYAÇ TALEPLERİ
    // =================================================================
    function test_TalepOlusturulur() public {
        _aileKaydet(stk1, AILE_HASH);
        vm.prank(stk1);
        uint256 id = kampanya.talepOlustur(AILE_HASH, YardimKampanyasi.Kategori.Battaniye, 4, 3);

        YardimKampanyasi.Talep memory t = kampanya.talepGetir(id);
        assertEq(t.aileHash, AILE_HASH);
        assertEq(uint8(t.kategori), uint8(YardimKampanyasi.Kategori.Battaniye));
        assertEq(t.adet, 4);
        assertEq(t.aciliyet, 3);
        assertEq(t.olusturan, stk1);
        assertEq(uint8(t.durum), uint8(YardimKampanyasi.TalepDurumu.Beklemede));
        assertEq(kampanya.bekleyenTalepSayisi(YardimKampanyasi.Kategori.Battaniye), 1);
    }

    function test_RevertWhen_KayitsizAileTalepEder() public {
        vm.expectRevert(bytes("Kayitsiz aile"));
        _talepOlustur(stk1, AILE_HASH, YardimKampanyasi.Kategori.Gida);
    }

    function test_RevertWhen_STKOlmayanTalepGirer() public {
        _aileKaydet(stk1, AILE_HASH);
        vm.expectRevert(bytes("STK degil"));
        _talepOlustur(bagisci1, AILE_HASH, YardimKampanyasi.Kategori.Gida);
    }

    function test_RevertWhen_AdetSifir() public {
        _aileKaydet(stk1, AILE_HASH);
        vm.expectRevert(bytes("Adet 0 olamaz"));
        vm.prank(stk1);
        kampanya.talepOlustur(AILE_HASH, YardimKampanyasi.Kategori.Gida, 0, 1);
    }

    function test_RevertWhen_AciliyetAralikDisinda() public {
        _aileKaydet(stk1, AILE_HASH);
        vm.expectRevert(bytes("Aciliyet 1-3 olmali"));
        vm.prank(stk1);
        kampanya.talepOlustur(AILE_HASH, YardimKampanyasi.Kategori.Gida, 1, 4);
    }

    function test_RevertWhen_AyniKategorideIkinciAcikTalep() public {
        _aileKaydet(stk1, AILE_HASH);
        _talepOlustur(stk1, AILE_HASH, YardimKampanyasi.Kategori.Gida);
        vm.expectRevert(bytes("Bu kategoride acik talep var"));
        _talepOlustur(stk2, AILE_HASH, YardimKampanyasi.Kategori.Gida);
    }

    function test_FarkliKategorilerdeAyniAndaTalepAcilabilir() public {
        _aileKaydet(stk1, AILE_HASH);
        _talepOlustur(stk1, AILE_HASH, YardimKampanyasi.Kategori.Gida);
        _talepOlustur(stk1, AILE_HASH, YardimKampanyasi.Kategori.Battaniye);
        assertEq(kampanya.talepSayisi(), 2);
    }

    function test_TalepDogrulanir() public {
        uint256 id = _dogrulanmisTalep(YardimKampanyasi.Kategori.Gida);
        assertEq(uint8(_durum(id)), uint8(YardimKampanyasi.TalepDurumu.Dogrulandi));
        assertEq(kampanya.talepGetir(id).dogrulayan, stk2);
    }

    function test_RevertWhen_OlusturanSTKKendiTalebiniDogrular() public {
        _aileKaydet(stk1, AILE_HASH);
        uint256 id = _talepOlustur(stk1, AILE_HASH, YardimKampanyasi.Kategori.Gida);
        vm.expectRevert(bytes("Olusturan STK dogrulayamaz"));
        vm.prank(stk1);
        kampanya.talepDogrula(id);
    }

    function test_RevertWhen_TalepIkiKezDogrulanir() public {
        uint256 id = _dogrulanmisTalep(YardimKampanyasi.Kategori.Gida);
        vm.expectRevert(bytes("Talep beklemede degil"));
        vm.prank(stk3);
        kampanya.talepDogrula(id);
    }

    function test_ReddedilenTalepSonrasiYeniTalepAcilabilir() public {
        _aileKaydet(stk1, AILE_HASH);
        uint256 id = _talepOlustur(stk1, AILE_HASH, YardimKampanyasi.Kategori.Gida);

        vm.prank(stk2);
        kampanya.talepReddet(id);
        assertEq(uint8(_durum(id)), uint8(YardimKampanyasi.TalepDurumu.Reddedildi));
        assertEq(kampanya.bekleyenTalepSayisi(YardimKampanyasi.Kategori.Gida), 0);

        _talepOlustur(stk1, AILE_HASH, YardimKampanyasi.Kategori.Gida);   // tekrar açılabildi
        assertEq(kampanya.talepSayisi(), 2);
    }

    function test_IhtiyacTablosu() public {
        bytes32 ikinciAile = keccak256(abi.encodePacked("M3P-11ZK-8QW5"));
        _aileKaydet(stk1, AILE_HASH);
        _aileKaydet(stk1, ikinciAile);
        _talepOlustur(stk1, AILE_HASH, YardimKampanyasi.Kategori.Battaniye);
        _talepOlustur(stk1, ikinciAile, YardimKampanyasi.Kategori.Battaniye);
        _talepOlustur(stk1, ikinciAile, YardimKampanyasi.Kategori.BebekMamasi);

        uint256[6] memory tablo = kampanya.ihtiyacTablosu();
        assertEq(tablo[uint8(YardimKampanyasi.Kategori.Gida)], 0);
        assertEq(tablo[uint8(YardimKampanyasi.Kategori.Battaniye)], 2);
        assertEq(tablo[uint8(YardimKampanyasi.Kategori.BebekMamasi)], 1);
    }

    // =================================================================
    // 5. TESLİM (TALEBE BAĞLI)
    // =================================================================
    function test_TeslimYapilir_TalepKarsilanir() public {
        uint256 id = _dogrulanmisTalep(YardimKampanyasi.Kategori.Gida);
        _teslimEt(stk3, AILE_KODU, id);

        assertEq(uint8(_durum(id)), uint8(YardimKampanyasi.TalepDurumu.Karsilandi));
        assertEq(kampanya.bekleyenTalepSayisi(YardimKampanyasi.Kategori.Gida), 0);
        assertFalse(kampanya.acikTalepVar(AILE_HASH, YardimKampanyasi.Kategori.Gida));
        assertEq(kampanya.toplamTeslim(), 1);

        (, uint256 sonTeslim, uint256 teslimSayisi) = kampanya.aileler(AILE_HASH);
        assertEq(sonTeslim, block.timestamp);
        assertEq(teslimSayisi, 1);
    }

    function test_RevertWhen_KayitsizKod() public {
        uint256 id = _dogrulanmisTalep(YardimKampanyasi.Kategori.Gida);
        vm.expectRevert(bytes("Kayitsiz kod"));
        _teslimEt(stk2, "HAYALET-AILE", id);
    }

    function test_RevertWhen_KaydedenSTKTeslimEder() public {
        uint256 id = _dogrulanmisTalep(YardimKampanyasi.Kategori.Gida);
        vm.expectRevert(bytes("Kaydeden STK teslim edemez"));
        _teslimEt(stk1, AILE_KODU, id);
    }

    function test_RevertWhen_STKOlmayanTeslimEder() public {
        uint256 id = _dogrulanmisTalep(YardimKampanyasi.Kategori.Gida);
        vm.expectRevert(bytes("STK degil"));
        _teslimEt(bagisci1, AILE_KODU, id);
    }

    function test_RevertWhen_DogrulanmamisTalepTeslimEdilir() public {
        _aileKaydet(stk1, AILE_HASH);
        uint256 id = _talepOlustur(stk1, AILE_HASH, YardimKampanyasi.Kategori.Gida);
        vm.expectRevert(bytes("Talep dogrulanmamis"));
        _teslimEt(stk2, AILE_KODU, id);
    }

    function test_RevertWhen_BaskaAileninTalebiIleTeslim() public {
        uint256 id = _dogrulanmisTalep(YardimKampanyasi.Kategori.Gida);
        _aileKaydet(stk1, keccak256(abi.encodePacked("M3P-11ZK-8QW5")));
        vm.expectRevert(bytes("Talep bu aileye ait degil"));
        _teslimEt(stk2, "M3P-11ZK-8QW5", id);
    }

    function test_RevertWhen_AyniTalepIkiKezTeslimEdilir() public {
        uint256 id = _dogrulanmisTalep(YardimKampanyasi.Kategori.Gida);
        _teslimEt(stk2, AILE_KODU, id);
        vm.expectRevert(bytes("Talep dogrulanmamis"));
        _teslimEt(stk3, AILE_KODU, id);
    }

    // =================================================================
    // 6. KATEGORİ BAZLI 30 GÜN KURALI
    // =================================================================
    function test_RevertWhen_29GunSonraAyniKategoridenTalep() public {
        uint256 id = _dogrulanmisTalep(YardimKampanyasi.Kategori.Gida);
        _teslimEt(stk2, AILE_KODU, id);

        vm.warp(block.timestamp + 29 days);
        vm.expectRevert(bytes("30 gun dolmadi"));
        _talepOlustur(stk1, AILE_HASH, YardimKampanyasi.Kategori.Gida);
    }

    function test_30GunSonraAyniKategoridenTalepVeTeslim() public {
        uint256 id1 = _dogrulanmisTalep(YardimKampanyasi.Kategori.Gida);
        _teslimEt(stk2, AILE_KODU, id1);

        vm.warp(block.timestamp + 30 days);
        uint256 id2 = _dogrulanmisTalep(YardimKampanyasi.Kategori.Gida);
        _teslimEt(stk3, AILE_KODU, id2);

        (, , uint256 teslimSayisi) = kampanya.aileler(AILE_HASH);
        assertEq(teslimSayisi, 2);
    }

    function test_GidaAldiktanHemenSonraBattaniyeIstenebilir() public {
        uint256 id1 = _dogrulanmisTalep(YardimKampanyasi.Kategori.Gida);
        _teslimEt(stk2, AILE_KODU, id1);

        vm.warp(block.timestamp + 1 days);          // sadece 1 gün sonra
        uint256 id2 = _dogrulanmisTalep(YardimKampanyasi.Kategori.Battaniye);
        _teslimEt(stk2, AILE_KODU, id2);

        assertEq(kampanya.toplamTeslim(), 2);
    }

    // =================================================================
    // 7. TOPLU İŞLEMLER: BİR AİLENİN BİRDEN FAZLA İHTİYACI
    // =================================================================
    function _altiKategori()
        internal
        pure
        returns (YardimKampanyasi.Kategori[] memory k, uint256[] memory adet, uint8[] memory aciliyet)
    {
        k = new YardimKampanyasi.Kategori[](6);
        adet = new uint256[](6);
        aciliyet = new uint8[](6);
        for (uint256 i = 0; i < 6; i++) {
            k[i] = YardimKampanyasi.Kategori(i);
            adet[i] = i + 1;
            aciliyet[i] = uint8((i % 3) + 1);
        }
    }

    function test_AileAltiKategoridenAyniAndaTalepEdebilir() public {
        _aileKaydet(stk1, AILE_HASH);
        (YardimKampanyasi.Kategori[] memory k, uint256[] memory adet, uint8[] memory aciliyet) = _altiKategori();

        vm.prank(stk1);
        uint256[] memory idler = kampanya.talepleriOlustur(AILE_HASH, k, adet, aciliyet);

        assertEq(idler.length, 6);
        assertEq(kampanya.talepSayisi(), 6);
        uint256[6] memory tablo = kampanya.ihtiyacTablosu();
        for (uint256 i = 0; i < 6; i++) {
            assertEq(tablo[i], 1);
            assertEq(kampanya.talepGetir(idler[i]).adet, i + 1);
        }
    }

    function test_RevertWhen_TopluTalepteAyniKategoriIkiKez() public {
        _aileKaydet(stk1, AILE_HASH);
        YardimKampanyasi.Kategori[] memory k = new YardimKampanyasi.Kategori[](2);
        k[0] = YardimKampanyasi.Kategori.Gida;
        k[1] = YardimKampanyasi.Kategori.Gida;
        uint256[] memory adet = new uint256[](2);
        adet[0] = 1;
        adet[1] = 1;
        uint8[] memory aciliyet = new uint8[](2);
        aciliyet[0] = 1;
        aciliyet[1] = 1;

        vm.expectRevert(bytes("Bu kategoride acik talep var"));
        vm.prank(stk1);
        kampanya.talepleriOlustur(AILE_HASH, k, adet, aciliyet);
        assertEq(kampanya.talepSayisi(), 0); // hiçbiri kaydedilmedi
    }

    function test_RevertWhen_TopluTalepListeUzunluklariFarkli() public {
        _aileKaydet(stk1, AILE_HASH);
        YardimKampanyasi.Kategori[] memory k = new YardimKampanyasi.Kategori[](2);
        uint256[] memory adet = new uint256[](1);
        uint8[] memory aciliyet = new uint8[](2);
        vm.expectRevert(bytes("Liste uzunluklari farkli"));
        vm.prank(stk1);
        kampanya.talepleriOlustur(AILE_HASH, k, adet, aciliyet);
    }

    function test_RevertWhen_TopluTalepListesiBos() public {
        _aileKaydet(stk1, AILE_HASH);
        vm.expectRevert(bytes("Talep listesi bos"));
        vm.prank(stk1);
        kampanya.talepleriOlustur(
            AILE_HASH, new YardimKampanyasi.Kategori[](0), new uint256[](0), new uint8[](0)
        );
    }

    function test_TopluDogrulamaVeTopluTeslim() public {
        _aileKaydet(stk1, AILE_HASH);
        (YardimKampanyasi.Kategori[] memory k, uint256[] memory adet, uint8[] memory aciliyet) = _altiKategori();
        vm.prank(stk1);
        uint256[] memory idler = kampanya.talepleriOlustur(AILE_HASH, k, adet, aciliyet);

        vm.prank(stk2);
        kampanya.talepleriDogrula(idler);

        // Aynı dağıtımda ilk üç kategori teslim ediliyor
        uint256[] memory ilkUc = new uint256[](3);
        ilkUc[0] = idler[0];
        ilkUc[1] = idler[1];
        ilkUc[2] = idler[2];
        vm.prank(stk3);
        kampanya.teslimleriOnayla(AILE_KODU, ilkUc);

        assertEq(kampanya.toplamTeslim(), 3);
        assertEq(uint8(_durum(idler[0])), uint8(YardimKampanyasi.TalepDurumu.Karsilandi));
        assertEq(uint8(_durum(idler[3])), uint8(YardimKampanyasi.TalepDurumu.Dogrulandi));
        uint256[6] memory tablo = kampanya.ihtiyacTablosu();
        assertEq(tablo[0] + tablo[1] + tablo[2], 0);
        assertEq(tablo[3] + tablo[4] + tablo[5], 3);
    }

    function test_RevertWhen_TopluDogrulamayiTalebiGirenYapar() public {
        _aileKaydet(stk1, AILE_HASH);
        (YardimKampanyasi.Kategori[] memory k, uint256[] memory adet, uint8[] memory aciliyet) = _altiKategori();
        vm.prank(stk1);
        uint256[] memory idler = kampanya.talepleriOlustur(AILE_HASH, k, adet, aciliyet);

        vm.expectRevert(bytes("Olusturan STK dogrulayamaz"));
        vm.prank(stk1);
        kampanya.talepleriDogrula(idler);
    }

    function test_RevertWhen_TopluTeslimdeBaskaAileninTalebiVar() public {
        bytes32 ikinciAile = keccak256(abi.encodePacked("M3P-11ZK-8QW5"));
        _aileKaydet(stk1, AILE_HASH);
        _aileKaydet(stk1, ikinciAile);
        uint256 benim = _talepOlustur(stk1, AILE_HASH, YardimKampanyasi.Kategori.Gida);
        uint256 baskasi = _talepOlustur(stk1, ikinciAile, YardimKampanyasi.Kategori.Gida);
        vm.startPrank(stk2);
        kampanya.talepDogrula(benim);
        kampanya.talepDogrula(baskasi);
        vm.stopPrank();

        uint256[] memory liste = new uint256[](2);
        liste[0] = benim;
        liste[1] = baskasi;
        vm.expectRevert(bytes("Talep bu aileye ait degil"));
        vm.prank(stk3);
        kampanya.teslimleriOnayla(AILE_KODU, liste);
        assertEq(kampanya.toplamTeslim(), 0); // yarım teslim kaydı kalmadı
    }
}
