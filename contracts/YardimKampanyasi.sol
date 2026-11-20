// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract YardimKampanyasi {
    struct Asama {
        string aciklama;
        uint256 tutar;
        uint256 onaySayisi;
        bool tamamlandi;
        bytes32 kanitHash;
    }

    address public yonetici;
    address payable public tedarikci;
    mapping(address => bool) public stkMi;
    uint256 public constant ESIK = 2;

    Asama[] public asamalar;
    mapping(uint256 => mapping(address => bool)) public onayladiMi;
    uint256 public siradakiAsama;

    mapping(address => uint256) public bagislar;
    uint256 public sonTarih;

    uint256 public toplamBagis;    // YENİ: tüm bağışların toplamı
    uint256 public iadeHavuzu;     // YENİ: iade başladığında kasada kalan para
    bool public iadeBasladi;       // YENİ

    event BagisYapildi(address indexed bagisci, uint256 miktar);
    event AsamaEklendi(uint256 indexed id, string aciklama, uint256 tutar);
    event AsamaOnaylandi(uint256 indexed id, address indexed stk, bytes32 kanitHash);
    event OdemeYapildi(uint256 indexed id, address tedarikci, uint256 tutar);
    event IadeYapildi(address indexed bagisci, uint256 miktar);

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

    function asamaEkle(string calldata aciklama, uint256 tutar) external sadeceYonetici {
        asamalar.push(Asama(aciklama, tutar, 0, false, bytes32(0)));
        emit AsamaEklendi(asamalar.length - 1, aciklama, tutar);
    }

    function bagisYap() external payable {
        require(block.timestamp <= sonTarih, "Kampanya sona erdi");   // YENİ
        require(msg.value > 0, "Bagis 0 olamaz");
        bagislar[msg.sender] += msg.value;
        toplamBagis += msg.value;                                       // YENİ
        emit BagisYapildi(msg.sender, msg.value);
    }

    function onayla(uint256 id, bytes32 kanitHash) external sadeceSTK {
        require(block.timestamp <= sonTarih, "Kampanya sona erdi");   // YENİ
        require(id < asamalar.length, "Asama yok");
        require(id == siradakiAsama, "Sira bu asamada degil");
        require(!onayladiMi[id][msg.sender], "Zaten onayladin");

        Asama storage a = asamalar[id];

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
            a.tamamlandi = true;
            siradakiAsama++;
            (bool ok, ) = tedarikci.call{value: a.tutar}("");
            require(ok, "Odeme basarisiz");
            emit OdemeYapildi(id, tedarikci, a.tutar);
        }
    }

    function iadeAl() external {
        require(block.timestamp > sonTarih, "Sure dolmadi");
        require(asamalar.length == 0 || siradakiAsama < asamalar.length, "Kampanya tamamlandi");  // YENİ: açık düzeltildi

        uint256 bagis = bagislar[msg.sender];
        require(bagis > 0, "Iade edilecek bagis yok");

        // YENİ: ilk iade isteğinde kasadaki parayı "dondur"
        if (!iadeBasladi) {
            iadeBasladi = true;
            iadeHavuzu = address(this).balance;
        }

        // YENİ: herkes bağışı oranında pay alır
        uint256 miktar = (bagis * iadeHavuzu) / toplamBagis;

        bagislar[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: miktar}("");
        require(ok, "Iade basarisiz");
        emit IadeYapildi(msg.sender, miktar);
    }

    function asamaSayisi() external view returns (uint256) {
        return asamalar.length;
    }

    function bakiye() external view returns (uint256) {
        return address(this).balance;
    }
}