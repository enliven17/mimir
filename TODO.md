# Mimir Yol Haritası

Ortak plan: teknik/güven temeli (Cankat + Fable) + SocialFi vizyonu (Cankat).
Sıra bağımlılığa göre dizildi. Üstteki fazlar alttakilerin önkoşulu.

## Prensipler

1. Settlement güveni her şeyin temeli. Kimse güvenmediği karara para yatırmaz.
2. Para hareketi olan hiçbir yola güvenilmez input fence'siz girmez (prompt injection, SSRF).
3. Fee ve SocialFi mekaniği, güvenilir settlement üstüne kurulur. Yoksa kötü kararları kopyalatmış oluruz.
4. Her market "sağlıklı" olmalı: bahis zamanı ile çözüm zamanı ayrı olmalı.
5. Önce mekanizma, sonra token. Token'ı mekanizma için kurarız, tersini değil.

---

## Faz 0: Mainnet öncesi zorunlu temel

Güvenlik denetimi düzeltmeleri uygulandı, ama devreye alınması gerekiyor.

- [ ] Kontratı yeni güvenlik düzeltmeleriyle yeniden derle (`viaIR`) ve Arc testnet'e redeploy et
- [ ] `artifacts/Mimir.bin` güncelle, `deploy/deploy.ts` yeni adresi yaz
- [ ] Yeni env değişkenlerini set et: `X402_PASS_SECRET` (ayrı HMAC), `X402_EVIDENCE_ALLOWLIST`
- [ ] `setPaused`, `acceptOwnership`, `getInviteKeyHash` için basit unit test (solc + node:test)
- [ ] Kalan transitive dep açıklarını (ws, tmp + moderate'ler) upstream sürüm çıkınca güncelle, `--force` KULLANMA (next'i 9'a düşürüyor)

---

## Faz 1: Market timing / sağlık kuralları (Cankat #7)

"Bugün yağmur yağacak mı" gibi bahis-anında-kapanan market'ler yasak. Bahis kapanışı
ile çözüm zamanı ayrılmalı.

- [ ] Kontrata iki ayrı zaman: `bettingClosesAt` (yeni bahis/challenge yok) ve `resolvesAt` (`>= bettingClosesAt + MIN_RESOLUTION_GAP`)
  - Şu an tek `deadline` hem bahis kapanışı hem settle-eligibility için kullanılıyor, ayrıştır
  - `challengeClaim`: `bettingClosesAt`'ten önce olmalı (anti-sniping mevcut 60sn mantığını buraya taşı)
  - `resolveClaim`: `resolvesAt`'ten sonra olmalı
- [ ] Validation: olayın çözümü bahis penceresi içinde olan market'i reddet (api-validation + market-creator)
  - Örn: bahis bugün kapanıyorsa, çözüm en az yarın olmalı
  - `MIN_RESOLUTION_GAP` ve kategori-bazlı minimum çözüm süresi tanımla
- [ ] market-creator: ürettiği market'lerde bu kurala uy (crypto/spor deadline mantığını güncelle)
- [ ] UI: market kartında "Bahis kapanış" ve "Çözüm" zamanlarını ayrı göster

---

## Faz 2: Settlement güveni (Fable ana tezi)

Karar = tek LLM + tek key olmaktan çıkmalı. Ekonomik güvenliğe dönüşmeli.

- [ ] **Optimistic oracle:** oracle kararı ÖNERİR, anında finalize etmez
  - Öneri sonrası itiraz penceresi aç (`disputeWindow`)
  - İtiraz eden USDC stake eder; itiraz yoksa ucuz+hızlı finalize
- [ ] **Eskalasyon:** itiraz varsa council + gerekirse insan/stake-ağırlıklı oylama karar verir
- [ ] **Slashing:** yanlış tarafta olan (itirazcı ya da oracle) stake'ini kaybeder
- [ ] **Deterministik adapter genişletme:** ESPN (spor), stockanalysis (hisse) için CoinGecko gibi API-tabanlı deterministik yol
  - Injection yüzeyini kapatır + "bu kategoride %100 güvenilir settlement" iddiası
  - Adapter dışı kaynaklar zaten confidence 75'e cap'leniyor, bunu koru
- [ ] **Oracle merkeziyetsizleştirme:** council-as-jury'i settlement'ta varsayılan yap ya da M-of-N imza
  - Şu an opsiyonel ("web server yoksa bloklamasın"), tek key compromise = tüm havuz drain riski

---

## Faz 3: Council birinci sınıf aktör (Cankat #1, #6)

Council sadece jüri değil, görünür bir tartışma ve market açan bir topluluk olsun.

- [ ] **Council sohbeti:** persona'lar birbirleriyle konuşsun (sıralı debate), sadece bağımsız oy değil
  - `agents/council/` çok-turlu tartışma akışı (her persona öncekileri görür, mevcut peer-read altyapısı temel)
  - Prompt injection guard'ı koru (peer-reads zaten fence'li)
- [ ] **Council debate UI:** tartışmayı canlı/replay göster (`/council` sayfası)
- [ ] **Filozof persona'lar ekle:** yeni karakterler (mevcut 10'un üstüne), `agents/council/personas.ts`
- [ ] **Council market açabilsin:** council/filozoflar da market-creator gibi market üretebilsin
  - market-creator akışını council'e bağla, açılan market'e "Council" rozeti

---

## Faz 4: Fee sistemi (Cankat #2)

Tüm monetizasyonun önkoşulu. Copy-trade ve sepetler buna dayanır.

- [ ] **Protokol fee:** settlement'ta havuzdan bps kesinti → treasury (`takeRateBps`, config'lenebilir)
- [ ] **Fee muhasebesi:** treasury adresi, biriken fee takibi, `withdraw` benzeri çekim
- [ ] **Creator fee:** market açan da bir kesinti kazanabilsin (fixed-odds ekonomisi zaten var, genişlet)
- [ ] **Fee dashboard:** `/revenue` sayfasına protokol fee gelirini ekle (x402 gelir defteri modeli hazır)
- [ ] Fee'leri x402 nanopayment raylarıyla mikro-granüler topla (mümkün olan yerde)

---

## Faz 5: SocialFi katmanı (Cankat #3, #4, #5)

Kullanıcı ajanları + copy trade + sepetler. Faz 2 (güven) ve Faz 4 (fee) önkoşul.

- [ ] **Bring-your-own-agent:** kullanıcı kendi ajanını bağlayabilsin
  - Bağlı ajan: market açıp kapatabilir, bet yapabilir, copy-trade atabilir
  - Ajan kimliği/cüzdanı (W3S veya kullanıcının kendi imzası), yetki sınırları, spend cap
- [ ] **Copy-trade (ajan + insan):** hem ajanları hem insanları kopyalayabil
  - Follower, leader'ın trade'lerini aynala (market aç/bet)
  - Kâr edilirse: leader'a performans fee + protokole fee (x402 ile öde)
  - Follower zaten sisteme fee ödüyor
- [ ] **Ajan sepetleri (baskets):** ajanlardan oluşan "index/fund"
  - Ajanlar ya da insanlar sepete yatırım yapabilir
  - Sepet kâr ederse: hem protokol hem ajan sahipleri fee kazanır
  - Sepet performans takibi, giriş/çıkış, NAV mantığı
- [ ] **Güven bağlantısı:** copy-trade ve sepetler sadece güvenilir settlement üstünde anlamlı (Faz 2 şart)
- [ ] Leaderboard: ajan/insan performansı, sepet getirileri (copy-trade akışını besler)

---

## Faz 6: Büyüme / dağıtım (Fable)

- [ ] **XMTP sosyal döngü:** arkadaşınla bahis, grup market'leri (messages altyapısı hazır)
- [ ] **Shareable / embeddable:** private-link modeli üstüne siteye gömülebilir market widget'ı
- [ ] **Açık ajan servis pazarı:** harici ajanlar x402 ile verdict/veri/reasoning satın alabilsin
  - Agent SDK + API katalog (fiyat, latency, güven skoru), moat burada
- [ ] **Agent market-maker:** auto-challenger'ı bilinçli likidite sağlayıcıya çevir (risk modeli, envanter, spread)

---

## Bağımlılık haritası (özet)

```
Faz 0 (güvenlik) ──► Faz 1 (timing) ──► Faz 2 (güven) ──┐
                                                         ├──► Faz 5 (SocialFi)
Faz 3 (council)  ─────────────────────► Faz 4 (fee) ────┘
                                                         └──► Faz 6 (büyüme)
```

Not: Faz 5 (copy-trade/sepet) hem Faz 2 (güvenilir settlement) hem Faz 4 (fee rayları)
olmadan kurulmamalı. Aksi halde kötü kararları kopyalatıp fee'siz büyütmüş oluruz.
