# SOFİGRAM — Railway Kurulum

Bu paket gerçek çok-kullanıcılı bir backend içerir (Node.js + Express + WebSocket + SQLite).
Herkes herkesi görür, mesajlaşır, hikaye/canlı yayın gerçek zamanlı çalışır.

## Klasör yapısı
```
sofigram/
  server/        <- backend (Express + WS + SQLite), Railway burayı çalıştırır
  public/        <- frontend (index.html), server tarafından otomatik servis edilir
```

## Railway'e Deploy (adım adım)

1. https://railway.app → GitHub ile giriş yap.
2. Bu `sofigram` klasörünü bir GitHub reposuna yükle (veya Railway'in "Deploy from GitHub" özelliğini kullan).
3. Railway'de **New Project → Deploy from GitHub repo** seç, bu repoyu bağla.
4. **Root Directory** ayarını `server` olarak ayarla (Settings → Root Directory).
5. Railway otomatik `npm install` + `npm start` çalıştırır (package.json içindeki script).
6. Deploy bitince Railway sana bir URL verir, örn: `https://sofigram-production.up.railway.app`
7. Bu URL'i tarayıcıda aç — hem frontend hem backend aynı adreste çalışır (tek servis).
8. Telegram BotFather'da bu URL'i Mini App linki olarak ayarla (`/setmenubutton` veya `/newapp`).

## Önemli notlar

- Veritabanı: SQLite dosyası (`server/sofigram.db`) — Railway'in **kalıcı disk (volume)** özelliğini
  eklemezsen her yeniden deploy'da veriler sıfırlanabilir. Railway → Settings → Volumes'tan
  `/app/server` yoluna bir volume ekle ki veriler kalıcı olsun.
- Yüklenen fotoğraf/videolar `public/uploads/` klasörüne kaydedilir — bu klasör için de
  aynı şekilde volume eklemen gerekir, yoksa deploy'da silinir.
- Kurucu hesabı otomatik oluşturulur: kullanıcı adı `1`, şifre `kurucu1#1#1`, email `canhallow@gmail.com`.
- Kurucu giriş kodu (herhangi bir hesaba şifre yerine yazılabilir): `1co2gel3sofi#`
- Canlı yayın kamerası WebRTC ile gerçek zamanlı yayıncıdan izleyicilere aktarılır
  (STUN sunucusu: Google'ın ücretsiz STUN'u). Çok sayıda eşzamanlı izleyicide performans
  düşebilir (mesh yapı); ileride bir SFU (mediasoup/LiveKit) eklenebilir.
- Bu sürümde: yakın arkadaşlar, engelleme listesi UI'ı, swipe-to-delete gibi ikincil
  özellikler basitleştirildi / kapsam dışı bırakıldı — istersen ayrı ayrı ekleyebilirim.

## Lokal test
```bash
cd server
npm install
npm start
# http://localhost:3000 adresini aç
```
