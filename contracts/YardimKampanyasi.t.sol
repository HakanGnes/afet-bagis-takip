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

    // ---------- Normal akış ----------
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

    // ---------- Saldırı / hata senaryoları ----------
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

    // ---------- Bulunan sorunların düzeltildiğinin kanıtı ----------
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
}