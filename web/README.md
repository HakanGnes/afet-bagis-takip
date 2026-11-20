# Afet bağışı takip: canlı demo sitesi

Sözleşmenin her adımını açıklayan ve işlemleri gerçekten zincire gönderen demo.
İki ağda çalışır:

| Ağ | Ne için | Komut |
|---|---|---|
| Yerel Hardhat ağı | Sunumda hızlı ve internetsiz demo, zaman ileri sarılabilir | `npm run dev` |
| Sepolia test ağı | Herkesin açabileceği link, Etherscan'de doğrulanabilen işlemler | `npm run dev:sepolia` |

Üst menüdeki **Hile denemelerini göster** anahtarı kırmızı saldırı denemelerini gösterir ya da gizler.

---

## 1. Yerel ağda çalıştırma

İki terminal gerekiyor, ikisi de proje kök klasöründe (`afet-bagis-takip`).

**Terminal 1: yerel blokzinciri** (açık kalmalı, kapatırsan zincir silinir)

```powershell
npx hardhat build
npx hardhat node
```

**Terminal 2: site**

```powershell
cd web
npm install        # sadece ilk seferde
npm run dev
```

Terminalde çıkan adresi (genelde http://localhost:5173) tarayıcıda aç.

- "Demoyu sıfırla" yeni bir sözleşme yükler. Zincirin saati ve bakiyeler ancak
  Terminal 1'deki `npx hardhat node` yeniden başlatılınca sıfırlanır.
- Yerel modda Hardhat'in herkesçe bilinen test anahtarları kullanılır; bunlar
  sadece yerel ağ içindir.

## 2. Sepolia'da çalıştırma

Sözleşmeyi yüklemek daha ucuz olsun diye önce optimize edilmiş derleme yap
(proje kök klasöründe):

```powershell
npx hardhat build --build-profile production
```

Sonra:

```powershell
cd web
npm run dev:sepolia
```

Site "Hazırlık" adımıyla açılır:

1. Site bu tarayıcı için 7 geçici cüzdan üretir (anahtarlar sadece bu tarayıcıda saklanır).
2. Yönetici adresini kopyala, [Google Cloud Sepolia faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)
   sayfasından bu adrese test ETH'si al (en az 0,05 ETH önerilir).
3. "Bakiyeleri yenile", ardından "Rollere test ETH dağıt".
4. "Kampanyayı kur" adımında süreyi seç (varsayılan 20 dakika) ve başlat.

Sepolia'da her işlem 10–20 saniye sürer. Zaman ileri sarılamadığı için:
- 30 gün kuralının sadece **reddetme** tarafı canlı gösterilir; izin verme tarafını
  otomatik testler ve yerel demo gösterir.
- İade adımında geri sayım vardır; süre dolunca iade düğmeleri çalışır.

**Paylaşma:** Kampanya başladıktan sonra üstte "Linki kopyala" çıkar. Linki açan
herkes kampanyayı salt okunur görür ve her işlemi Etherscan'de doğrulayabilir.

RPC sorun çıkarırsa `web/.env.sepolia` dosyasında `VITE_RPC_URL` ile başka bir
ücretsiz adres deneyebilirsin.

## 3. GitHub Pages'te yayınlama (isteğe bağlı)

Proje GitHub'a yüklü olmalı. `web` klasöründe:

```powershell
npm run yayinla
```

Bu komut siteyi Sepolia için derler ve `gh-pages` dalına gönderir. Ardından
GitHub'da repo → **Settings → Pages** → Source: "Deploy from a branch", Branch:
`gh-pages` seç. Birkaç dakika sonra site
`https://<kullanici-adin>.github.io/afet-bagis-takip/` adresinde açılır.
(Ücretsiz hesapta GitHub Pages için repo herkese açık olmalı.)

Yayındaki site de aynı şekilde çalışır: ziyaretçi kendi geçici cüzdanlarıyla
kendi demosunu yapabilir ya da paylaştığın linkle senin kampanyana salt okunur bakabilir.
