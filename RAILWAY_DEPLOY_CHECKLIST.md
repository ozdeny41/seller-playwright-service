# Railway Deploy Kontrol Listesi

GitHub'a push yaptığınız halde servis deploy olmuyorsa, Railway Dashboard'da aşağıdakileri sırayla kontrol edin.

---

## 1. Doğru proje ve servis

- [ ] **Proje:** `seller-playwright-service` için ayrı bir Railway **projesi** var mı? (Ana repo `29.07.2025` ile aynı projede olabilir veya olmayabilir.)
- [ ] **Servis:** Bu projede **hangi servisin** GitHub’a bağlı olduğundan emin olun (örn. "seller-playwright-service" adlı bir service).

---

## 2. Repo bağlantısı

- [ ] **Settings → Source:** Bağlı repo **`ozdeny41/seller-playwright-service`** mi? (Ana repo `ozdeny41/29.07.2025` değil.)
- [ ] **Branch:** Varsayılan branch **`main`** (veya push yaptığınız branch) seçili mi?
- [ ] Bağlantı kopmuşsa **"Connect Repo"** / **"Reconnect"** ile tekrar bağlayın.

---

## 3. Otomatik deploy ayarı

- [ ] **Settings → Deploy:** **"Deploy on push"** / **"Auto Deploy"** açık mı?
- [ ] **Deploy branch:** Sadece belirli branch’ler deploy ediliyorsa, push yaptığınız branch (örn. `main`) listede var mı?

---

## 4. Build / start hataları

- [ ] **Deployments** sekmesinde son deploy’a tıklayın.
- [ ] **Build logs:** Build aşamasında hata var mı? (örn. `npm install` hatası, eksik dependency.)
- [ ] **Deploy logs:** Container başlarken (start script) hata var mı? (örn. `PORT` yok, node crash.)
- [ ] **Status:** Deploy "Crashed" veya "Failed" ise log’daki ilk kırmızı satırı not alın ve düzeltin.

---

## 5. Root directory (monorepo ise)

- [ ] Repo tek proje değilse **Settings → Build → Root Directory** doğru klasörü gösteriyor mu? (`seller-playwright-service` tek repo ise boş/genelde kök yeterli.)

---

## 6. Build / start komutları

- [ ] **Settings → Build:** Build komutu boş bırakılmışsa Railway `package.json`’daki `scripts` kullanır. `npm run build` gerekmiyorsa boş olabilir.
- [ ] **Settings → Start / Deploy:** Start komutu doğru mu? (örn. `npm start` → `node src/server.js` veya `node .`)

---

## 7. Environment variables

- [ ] **Variables** sekmesinde servisin çalışması için gerekli değişkenler tanımlı mı? Eksik olanlar **build** veya **runtime** hatasına yol açabilir.

---

## Özet: En sık nedenler

| Sorun | Nerede bakılır |
|-------|-----------------|
| Yanlış repo bağlı (ana repo) | Settings → Source |
| Yanlış branch | Settings → Source → Branch |
| Otomatik deploy kapalı | Settings → Deploy |
| Build hatası | Deployments → Son deploy → Build logs |
| Start/crash hatası | Deployments → Son deploy → Deploy logs |

Bu listeyi kontrol ettikten sonra hâlâ deploy olmuyorsa, **Deployments** sekmesinde "Trigger Deploy" / "Redeploy" ile manuel deploy deneyin; hata mesajı çıkarsa ona göre ilerleyin.
