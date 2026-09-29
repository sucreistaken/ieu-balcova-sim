# Veri seti

Simülasyon iki işlenmiş dosyadan beslenir: `data/campus.json` (coğrafya, binalar, bilgi kartları) ve `data/real.json` (oda kodları, ders dilimleri, takvim, çalışma saatleri). İkisi de ham kaynaklardan betiklerle üretilir. Ayrıca bina kütleleri `js/campus_arch.js` içinde, fotoğraf tabanlı ve açıkça tahmin olarak işaretlenmiş bir tabloda durur.

## Koordinat sistemi

Yerel çerçeve, kampüs merkezinde (38.3887 K, 27.0445 D) başlar. `+x` doğu, `+z` güney (kuzey `-z`), `+y` yukarı. Birim metre. `y`, kampüs merkezinin deniz seviyesinden yüksekliğine (`terrain.elevOrigin`, 70,4 m) göre verilir. Halkalar (`ring`, `r`, `p`) düz dizilerdir: `[x0, z0, x1, z1, ...]`.

## Dosyalar

| Dosya | İçerik | Kaynak |
| --- | --- | --- |
| `campus.json` | Coğrafya, binalar, kapılar, yer kartları | Aşağıdakilerin birleşimi |
| `real.json` | Oda kodları (kat bazlı), ders başlangıçları, SFL pencereleri, akademik takvim, çalışma saatleri, varsayımlar | `data/research/*.json` dosyalarından `tools/build_real.mjs` ile |
| `research/rooms.json` | E Blok sınıf kodları (61), laboratuvar kayıtları (53), bölüm ofisleri, birimler, ders dilimleri, kodlama düzeni, boşluklar | ieu.edu.tr alt siteleri (SFL duyurusu, fecs, ffad, comp), OBS kılavuzu |
| `research/operations.json` | Hizmetler ve saatleri, akademik takvim (278 kayıt), etkinlikler, gelenekler, kulüpler, olgular, boşluklar | tim.ieu.edu.tr, ieu.edu.tr/tr/akademik-takvim, kütüphane, kulüp sayfaları |
| `research/courses.json` | 16 programın ECTS ders kataloğu (1.432 satır), ortak seçmeli havuzlar | ects.ieu.edu.tr (açık, girişsiz) |
| `research/visual_and_lore.json` | Bina görünüm notları, tarihçe (20), bilgiler (15), sürpriz fikirleri, boşluklar | Wikimedia Commons, 25yil.ieu.edu.tr, resmî sayfalar, Vikipedi |
| `osm_raw.json` | Kampüs çevresi: bina, yol, alan, isimli noktalar | OpenStreetMap, Overpass |
| `osm_relations.json` | C Blok ve E blok (çok parçalı poligon) | OpenStreetMap |
| `osm_tier1.json`, `osm_tier2.json` | Geniş çevre binaları, yollar, alanlar; uzak bina kutuları | OpenStreetMap |
| `osm_landcover.json`, `osm_aerialway.json`, `osm_coast.json` | Orman/çim alanları, teleferik, kıyı | OpenStreetMap |
| `dem_world.json` | 85 x 95 yükseklik ağı (yaklaşık 35 m) | EU-DEM 25 m, OpenTopoData API |
| `campus_info.json` | Yer açıklamaları, kaynaklı bilgi kartları, notlar | Elle derlendi (kaynak alanı ile) |
| `departments_raw.json`, `labs.json` | Fakülte, program ve laboratuvar listeleri | ieu.edu.tr |

Alma tarihi: 29-30 Eylül 2026. OpenStreetMap verisi ODbL lisanslıdır, © OpenStreetMap katkıcıları. Araştırma dosyalarında kişi adı, e-posta ve telefon tutulmadı.

## `campus.json` alanları

- `meta`: ad, adres, başlangıç noktası, kaynaklar, notlar, sayımlar.
- `campusRing`: kampüs sınırı (OSM `amenity=university`, Balçova Kampüsü).
- `terrain`: `rows`, `cols`, `xMin`, `xMax`, `zMin`, `zMax`, `heights` (satır 0 = kuzey), `elevOrigin`.
- `buildings[]`: `id`, `name`, `cat`, `kind`, `levels`, `h`, `hsrc`, `area`, `c`, `ring`, `holes`, `campus`, `special`.
  - `hsrc`: `osm` (OSM'de kat veya yükseklik var), `est` (tahmin) ya da `foto` (çalışma zamanında `campus_arch.js` ile fotoğraflardan düzeltildi).
- `far[]`, `roads[]`, `areas[]`, `pois[]`, `gondola`, `coast`, `nav`, `doors[]`, `info` (yer kartları, olanaklar, ulaşım, birimler, laboratuvarlar).

## `real.json` alanları

- `rooms[bina_id]`: `prefix` (blok öneki), `floors[kat] = [{ code, name, type, use?, src }]`, `floorOffset?`. Anahtar OSM bina kimliğidir (E blok 88435610, C Blok 88435600, D blok 637305654, TESLA 637305659, A, K ve M 154001110). Kodun ilk rakamı kattır.
- `periods`: ders başlangıçları (`08:30`...`15:50`), `lessonMinutes` (45, tahmin).
- `sfl.windows`: hazırlık seviyeleri (A, B, C), günler (1 = Pzt), başlangıç ve bitiş.
- `calendar`: `terms`, `exams`, `holidays`, `makeups` (lisans izi).
- `hours[ad]`: hafta içi, cumartesi, pazar için `[açılış, kapanış]` dakika olarak.
- `assumptions`: kaynakta olmayıp varsayılan noktalar.

## Çalışma zamanında yapılan düzeltmeler (`js/campus_arch.js`)

OSM taban alanları iyidir, yükseklikleri ve bazı poligonları eksiktir. Kod, yükleme sırasında şunları uygular ve hepsini `hsrc = 'foto'` ile işaretler:

- **A, K ve M Bloklar**: OSM'de tek poligon; içinde ana gövde, batı kanadı, saçaklı giriş, yuvarlak salon ve **açık avlu** birleşik. Avlu (z < 28,6) poligondan çıkarıldı (yürünebilir açık zemin), yuvarlak salon ayrı bina (`id 900000001`, işlevi doğrulanamadı) yapıldı, ana gövde bölgelere ayrıldı (batı kanadı 28 m, gövde 25,5 m, giriş bloğu 4,7 m). Gerçek ana kapı (saçağın altı) sentetik kapı olarak eklendi ve **0. katı belirler**; kuzey avlusu 7 m aşağıdadır, bu yüzden bina yamaca gömülüdür ve altında iki bodrum kat oluşur (PGDM "A Blok -1. kat" ile uyumlu).
- **Yurt** 5 yerine ~11 kat, **E Blok** 4 yerine 7 kat, C, D, TESLA, Reklamcılık cephe stilleri, Medya İletişim gri metal beşik çatı.
- Fotoğraf ve uydu kaynakları yalnız inceleme içindir (Wikimedia Commons CC BY-SA, Esri uydu); projeye görüntü gömülmedi. Renk, doku ve logo prosedürel olarak yeniden çizildi.

## Doğrulama kaydı

Bu oturumda araştırma çıktılarından **kaynağa gidip kendim kontrol ettiklerim**:

- E Blok sınıf tablosu (AST 01 → E 101 ... CST 14 → E 609) ve ders pencereleri: SFL duyurusu (id 13829) ile birebir uyuşuyor.
- C Blok laboratuvar kodları (C 601, 602, 604, 605, 608, 609): fecs.ieu.edu.tr sayfasında var. C 302-309 kayıtları başka sayfadan; bu sayfada yok, yeniden doğrulanmadı.
- Akademik takvim: lisans izinde dersler 21 Eylül 2026'da başlıyor, ara sınav 7-15 Kasım, final 4-13 Ocak, 29 Ekim tatil: sayfadaki sekmelerle uyuşuyor.
- Ders başlangıç saatleri (08:30 ... 15:50): OBS ders kayıt ekranı görüntüsünden okundu.
- Kafe ve Starbucks saatleri: tim.ieu.edu.tr/tr/is-ortaklari sayfasıyla uyuşuyor.
- YDYO (E Blok) parsel 1.345 m², toplam inşaat 9.646 m², Eylül 2015 (arkiv.com.tr); TESLA Mayıs 2018, 13 araştırma birimi, 1.260 m² (2020 kurumsal değerlendirme raporu).

**Kontrol etmeden aldıklarım** (araştırma ajanlarının raporundan, kaynak alanlarıyla): D Blok ve TESLA laboratuvar kodları, A Blok ofis kodları, kulüp sayısı, yurt kapasitesi, amfi teknik ölçüleri, ders kataloğu satırları (ajan 75 satırı ham HTML ile karşılaştırdığını bildirdi). Bu verilerin kart ve etiketleri kaynak adını taşır.

## Bilinen boşluklar

- Lisans haftalık ders programı, sınav programı ve derslik atamaları girişli sistemlerde; yok.
- A, C, K, M bloklarında derslik kodları ve kapasiteler bulunamadı; kat planı ve tahliye planı yok.
- Ders bitiş saatleri ve teneffüs süreleri yayımlanmıyor.
- Fakülte ve bölümlerin çoğunun blok eşlemesi yok (bilinenler: Tıp C Blok, GSTF D Blok, SFL E Blok, MYO ofisleri A Blok).
- Yeme içme işletmelerinin çoğunun binadaki konumu yok. Yuvarlak salon, gri çatılı uzun salon ve rektörlük konumu bilinmiyor.
- OSM'de iç mekân verisi (`indoor`, `level`, `room`) yok.
- Ayrıntılı listeler her `research/*.json` dosyasında `gaps` alanındadır.

## Yeniden üretme

```bash
python3 tools/fetch_dem.py        # yükseklik ağı (OpenTopoData genel API, dakikada sınırlı)
node tools/build_dataset.mjs      # campus.json
node tools/build_real.mjs         # real.json (data/research/*.json gerekir)
node tools/test_layout.mjs        # kat planı üreticisini tüm binalarda dener
```
