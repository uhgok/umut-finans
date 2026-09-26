# Umut Finans — Web Site Starter

Bu sürüm, Excel'den daha temiz bir kişisel portföy takip sitesi için hazırlanmış bir "production-ready starter"dır.

## İçerik
- `index.html`: görsel ve responsive portföy terminali
- `api/history.js`: sunucu tarafında Yahoo Finance Chart'tan günlük tarihsel veri çeken Vercel/Node serverless endpoint
- `supabase/schema.sql`: kalıcı veritabanı için PostgreSQL şeması
- `vercel.json`: Vercel function ayarı
- `.env.example`: üretim ortamı değişkenleri

## Otomatik fiyat
Site yayınlandığında frontend `/api/history` endpoint'ini çağırır. Bu endpoint tarayıcıdan değil sunucudan Yahoo Finance Chart'a bağlanır. Günlük `1d` kapanışlar alınır, son 365 günün verisi tutulur. Site otomatik yenileme düğmesine de sahiptir.

Yahoo Finance Chart erişimi üçüncü taraf/ünofficial bir veri yolu olduğundan yayınlamadan önce kullanım şartları ve veri yeniden dağıtım koşulları kontrol edilmelidir. Kurumsal kullanımda lisanslı bir veri sağlayıcısına geçiş için `MARKET_DATA_PROVIDER` katmanı ayrılabilir.

## Yerel çalıştırma
`index.html` doğrudan açıldığında arayüz çalışır ve seed/fallback verisini gösterir. Otomatik API için bir HTTP sunucusu gerekir:
- Vercel'e yükleme
- veya Node tabanlı bir yerel sunucu

## Üretime geçiş
1. Domain al.
2. Bu projeyi GitHub'a koy.
3. Vercel'e bağla.
4. Supabase projesi aç ve `supabase/schema.sql` çalıştır.
5. Kimlik doğrulama ve RLS ekle.
6. Gün sonu senkronizasyonunu Supabase Cron + Edge Function ile planla.

Supabase Cron, `pg_cron` üzerinden zamanlanmış işler oluşturup Edge Function/HTTP çağırabiliyor.
