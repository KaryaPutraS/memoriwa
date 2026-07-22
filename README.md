# MemoriWA — WhatsApp Document Intelligence

Dashboard self-hosted yang mengubah satu nomor WhatsApp menjadi kotak masuk
dokumen pintar. Hubungkan nomor lewat scan QR, dan setiap dokumen
(PDF, DOCX, XLSX, PPTX, TXT, CSV) maupun foto yang dikirim ke nomor itu
akan muncul di dashboard secara real-time — lengkap dengan pencarian,
statistik, analisis AI, dan alur dokumentasi kegiatan via foto.

## Install dengan 1 baris perintah (VPS Ubuntu/Debian)

```bash
curl -fsSL https://raw.githubusercontent.com/KaryaPutraS/memoriwa/main/install.sh | bash
```

Script ini otomatis: menginstall Docker jika belum ada, mengunduh repo,
membuat semua secret acak, lalu membuild dan menjalankan tiga container
(`waha`, `api`, `web`). Di akhir akan ditampilkan URL dashboard dan
password admin Anda. Selesai dalam ±3 menit.

**Mode non-interaktif** (tanpa tanya-jawab, cocok untuk otomasi):

```bash
curl -fsSL https://raw.githubusercontent.com/KaryaPutraS/memoriwa/main/install.sh \
  | bash -s -- --domain dash.contoh.com --port 80 -y
```

**Update instalasi yang sudah ada:** jalankan perintah yang sama sekali
lagi — file `.env`, sesi WhatsApp, dan data dokumen Anda tetap aman.

### Custom port

Secara default dashboard disajikan di **port 80**, jadi bisa dibuka di
`http://domain-atau-ip-anda` tanpa menulis port. Jika port 80 sudah dipakai
aplikasi lain di server Anda, pilih port lain saat install:

```bash
curl -fsSL https://raw.githubusercontent.com/KaryaPutraS/memoriwa/main/install.sh \
  | bash -s -- --port 8080
```

Dashboard kemudian tersedia di `http://domain-atau-ip-anda:8080`.

Catatan:

- **Sudah terlanjur install?** Jalankan ulang installer dengan `--port`
  baru (`.env` dan data tetap tersimpan), atau edit baris `WEB_PORT=` di
  `~/memoriwa/.env` lalu jalankan `docker compose up -d` dari `~/memoriwa`.
- Hanya port web yang terekspos ke publik. API (8000) dan WAHA (3000)
  tetap berada di dalam jaringan Docker dan tidak bisa diakses dari internet.
- Di balik Cloudflare atau reverse proxy lain? Arahkan ke port web dan
  sesuaikan `PUBLIC_URL` (misalnya `https://dash.contoh.com`).

## Setelah install

1. Buka URL dashboard dan login.
2. Masuk ke **Settings → Connect**, lalu scan QR code dengan nomor
   WhatsApp yang akan menerima dokumen.
3. Kirim dokumen dari nomor lain — dokumen langsung muncul di Inbox
   secara real-time.

### Alur dokumentasi kegiatan (foto)

Kirim satu atau beberapa foto, lalu kirim satu pesan teks setelahnya:
teks tersebut menjadi penjelasan dan otomatis mengelompokan rentetan foto
itu di Inbox. Klik **Verify** untuk menyimpannya ke Files (tanpa AI).
Caption yang dikirim bersama foto juga berfungsi dengan cara yang sama.

## Install manual

```bash
git clone https://github.com/KaryaPutraS/memoriwa.git
cd memoriwa
cp .env.example .env   # isi dengan nilai asli (openssl rand -hex 32)
docker compose up -d --build
```

### Konfigurasi (.env)

| Variabel | Keterangan |
|---|---|
| `PUBLIC_URL` | URL publik dashboard, misal `http://dash.contoh.com` |
| `WEB_PORT` | Port dashboard di host (default 80) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Login dashboard |
| `JWT_SECRET` | Secret penandatangan sesi (min. 32 karakter) |
| `WEBHOOK_SECRET` | Secret bersama untuk melindungi webhook WAHA |
| `WAHA_API_KEY` | API key yang dipakai bersama service WAHA |
| `GROQ_API_KEY` | API key AI cadangan untuk OCR/analisis (opsional) |
| `CAPTION_BURST_GAP_SEC` | Jeda maksimal antar foto dalam satu rentetan (default 120) |

## Kelola aplikasi

```bash
cd ~/memoriwa
docker compose logs -f     # melihat log
docker compose down        # berhenti
docker compose up -d       # menjalankan kembali
```

## Keamanan

- Login JWT (12 jam), pembatasan percobaan login, password di-hash PBKDF2
- Webhook dengan shared-secret, validasi origin+token WebSocket, proteksi SSRF
- API key provider AI disimpan terenkripsi (Fernet)
- Hanya port web yang terekspos; `api` dan `waha` tetap di dalam jaringan Docker

## Engine WhatsApp & catatan risiko banned

MemoriWA menggunakan WAHA dengan **engine NOWEB** — berkomunikasi langsung
lewat protokol multi-device WhatsApp tanpa browser headless, sehingga jauh
lebih hemat RAM dan fingerprint-nya lebih mirip aplikasi asli dibanding
otomasi browser. Sistem ini juga murni **receive-only** (tidak pernah
mengirim pesan), pola penggunaan dengan risiko paling rendah. Meski begitu,
setiap klien WhatsApp unofficial melanggar ToS dan tetap punya risiko
banned — tidak ada tools unofficial yang 100% aman. Aturan praktisnya:

- Gunakan **nomor khusus/secondary**, jangan nomor utama Anda
- Jangan kirim pesan dari nomor yang terhubung lewat API
- Jaga sesi tetap stabil: hindari logout/pairing berulang kali
- Untuk risiko nol, satu-satunya jalan adalah WhatsApp Business Cloud API resmi

## Development

```bash
# Test backend (32 test)
cd backend && pip install -r requirements.txt && pytest -q

# Dev server frontend
cd frontend && npm install && npm run dev
```

Stack backend saja untuk development (api + waha di localhost):
`cd backend && docker compose up -d --build`
