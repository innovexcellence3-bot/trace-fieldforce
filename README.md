# TRACE · Field Force Location Intelligence

Aplikasi web untuk verifikasi lokasi visit field force: membandingkan titik GPS visit dengan lokasi toko
(store master), lalu mendeteksi **Location Mismatch**, **Rapid Same Location**, dan **Visit After 7 PM**,
lengkap dengan peta, drill-down wilayah, geotag recommendation, dan export.

Data bisa diambil dengan tiga cara:

1. **Query Snowflake** langsung dari aplikasi (login SSO `externalbrowser`).
2. **Data Tersimpan**: setiap hasil query/upload disimpan sebagai CSV di `data/cache/`, jadi bisa dibuka
   lagi kapan saja **tanpa query ulang**.
3. **Upload CSV** hasil export manual.

```
trace-fieldforce/
├── server/                 Backend Node.js (Express)
│   ├── index.js            API /api/... + menyajikan frontend/dist
│   ├── snowflake.js        koneksi SSO + streaming hasil query ke CSV
│   ├── datasets.js         Data Library (data/cache/*.csv + *.meta.json)
│   ├── config.js           baca .env
│   └── sql/visit_verification.sql   query visit (KPS week & channel jadi parameter)
├── frontend/               UI — Vite + JavaScript (ES modules), Chart.js, Leaflet
│   ├── index.html
│   └── src/
│       ├── main.js         entry point, navigasi, buka dataset
│       ├── api.js          semua panggilan ke server
│       ├── core/           helper DOM & state bersama
│       ├── engine/         parsing CSV streaming + engine anomaly (logika sama dengan trace21.html)
│       ├── ui/             dashboard, grafik, tabel, peta, filter, export, sumber data
│       └── styles/main.css
├── data/cache/             dataset tersimpan (dibuat otomatis, tidak di-commit)
├── scripts/use-node.bat    menyiapkan Node.js portable untuk file .bat
├── setup.bat / start.bat / dev.bat
├── .env.example            setting default (Snowflake account, user, warehouse, port)
└── legacy/trace21.html     versi lama (single HTML), untuk referensi
```

## Windows: cukup double-click (tanpa install Node.js)

Sama seperti Lacak Pilot dan initiative_studio, Node.js **tidak perlu diinstall**. Versi portable
diunduh ke `.tools\` dan hanya dipakai di jendela script ini, seperti sebuah virtual environment.

1. **`setup.bat`** (sekali saja):
   - mengunduh Node.js portable resmi dari nodejs.org ke `.tools\` (dicek checksum SHA-256-nya),
   - membuat `.env` dari `.env.example`,
   - memasang dependency (`node_modules`),
   - mem-build tampilan.
2. **`start.bat`** setiap kali mau memakai aplikasi. Server berjalan di http://localhost:8020 dan
   browser terbuka otomatis. Tutup jendelanya untuk mematikan server. Kalau setup belum pernah
   dijalankan, `start.bat` menjalankannya sendiri.

Kalau laptop tidak punya internet, salin folder `node-v24.21.0-win-x64` dari folder initiative_studio /
Lacak Pilot ke root folder ini. Script akan memakainya dan tidak mengunduh apa pun.

`dev.bat` menjalankan mode development: server dengan auto-reload dan UI di http://localhost:5174.

## Snowflake

Setting ada di `.env` (dibuat dari `.env.example` saat setup):

| Key | Default |
| --- | --- |
| `SNOWFLAKE_ACCOUNT` | `pmi-pmi_id` |
| `SNOWFLAKE_HOST` | `pmi-pmi_id.snowflakecomputing.com` |
| `SNOWFLAKE_USER` | `mmahendr@PMINTL.NET` |
| `SNOWFLAKE_AUTHENTICATOR` | `externalbrowser` |
| `SNOWFLAKE_DATABASE` | `DB_ID_PRD` |
| `SNOWFLAKE_WAREHOUSE` | `WH_ID_COMMERCIAL_DA` |
| `SNOWFLAKE_ROLE` | kosong (pakai default role user) |

Username juga bisa diganti dari UI (**Query Snowflake → Pengaturan login**) tanpa mengubah `.env`.

Alur query:

1. Isi **KPS Week awal/akhir** dan **Channel**, lalu klik **Jalankan query**.
2. Saat pertama kali, tab baru di browser terbuka untuk **login SSO**. Setelah login, kembali ke TRACE.
   Koneksi dipakai ulang selama aplikasi menyala, jadi query berikutnya tidak perlu login lagi.
3. Hasil di-stream baris per baris ke `data/cache/<id>.csv` (aman untuk jutaan baris), lalu muncul di
   **Data Tersimpan**. Klik **Buka dashboard**.

Query ada di `server/sql/visit_verification.sql`. Week dan channel dikirim sebagai bind parameter (`?`),
bukan disisipkan ke teks SQL.

## Perintah npm (untuk development)

```bash
npm install        # dependency
npm run dev        # server :8020 (auto-reload) + UI Vite :5174 (hot reload)
npm run build      # build UI ke frontend/dist
npm start          # server + UI hasil build di :8020
```

Butuh Node.js 20+ (atau jalankan dari jendela yang sudah memanggil `scripts\use-node.bat`).

## API

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/health` | cek server |
| GET | `/api/config` | info koneksi Snowflake + SQL |
| GET | `/api/datasets` | daftar Data Tersimpan |
| GET | `/api/datasets/:id/file` | isi CSV (dipakai dashboard) |
| GET | `/api/datasets/:id/download` | unduh CSV |
| PATCH | `/api/datasets/:id` | ganti nama / simpan ringkasan |
| DELETE | `/api/datasets/:id` | hapus dataset |
| POST | `/api/datasets/upload` | upload CSV (body = isi file, header `X-File-Name`) |
| POST | `/api/snowflake/query` | `{ weekFrom, weekTo, channel, name?, user? }` → `{ jobId }` |
| GET | `/api/jobs/:id` | progress query |
| POST | `/api/jobs/:id/cancel` | batalkan query |
| POST | `/api/snowflake/disconnect` | putuskan koneksi Snowflake |

## Format CSV

Kolom wajib (huruf besar/kecil bebas): `customer_code, kps_week, visit_start_timestamp, isms_lat_visit,
isms_lon_visit, isms_lat_customer, isms_lon_customer, zone_name, territory_code`. Kolom lain dari query
(`region_name, area_name, district_code, employee_name, supervisor_name`, dst.) dipakai bila ada.
`visit_start_timestamp` berformat `YYYY-MM-DD HH:MM:SS[.fff]`.

Perhitungan anomaly berjalan di browser (cepat & interaktif saat parameter atau filter diubah), sedangkan
server mengurus koneksi Snowflake dan penyimpanan data. Data tidak dikirim ke mana pun selain laptop Anda.
