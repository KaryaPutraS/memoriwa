# 🧠 MemoriWA — WhatsApp Document Intelligence

**Your personal WhatsApp document brain. Connect once, every document flows in.**

MemoriWA adalah dashboard self-hosted yang menghubungkan nomor WhatsApp Anda ke sistem manajemen dokumen otomatis. Setiap kali seseorang mengirim dokumen (PDF, Word, Excel) atau gambar ke nomor WhatsApp Anda, file tersebut otomatis muncul di dashboard — lengkap dengan filter, pencarian, dan analisis AI.

> 💡 **1 dashboard = 1 nomor WhatsApp.** Desain single-tenant: setiap orang install instance sendiri. Tidak ada multi-user, tidak ada komplikasi.

---

## 📖 Daftar Isi

- [Fitur Utama](#-fitur-utama)
- [Cara Kerja](#-cara-kerja)
- [Prasyarat](#-prasyarat)
- [Instalasi Cepat](#-instalasi-cepat)
- [Konfigurasi Lengkap](#-konfigurasi-lengkap)
- [Panduan Penggunaan](#-panduan-penggunaan)
- [Arsitektur](#-arsitektur)
- [FAQ](#-faq)
- [Troubleshooting](#-troubleshooting)
- [Tech Stack](#-tech-stack)
- [Development](#-development)
- [Lisensi](#-lisensi)

---

## ✨ Fitur Utama

| Fitur | Deskripsi |
|---|---|
| 🔗 **WhatsApp Connect** | Scan QR sekali — semua dokumen & gambar otomatis masuk Inbox |
| 📎 **Auto-Filter** | Hanya PDF, DOCX, XLSX, PPTX, TXT, CSV, JPG, PNG, WEBP yang disimpan |
| 🤖 **AI Analysis** | Manual trigger per-file atau massal: klasifikasi, ringkasan, ekstraksi entitas |
| 🏪 **Multi-Provider AI** | OpenAI, Anthropic, DeepSeek, Gemini, Groq, Ollama, OpenRouter, Custom |
| ⚡ **Real-Time** | WebSocket push — file baru langsung muncul tanpa refresh |
| 📱 **Mobile Friendly** | Neo-Brutalist UI, responsive dari HP sampai desktop |
| 🔒 **Self-Hosted** | Docker Compose, semua data di server Anda sendiri |
| 🔐 **Enkripsi API Key** | Key provider AI dienkripsi Fernet AES-128 sebelum disimpan |

---

## 🔄 Cara Kerja

1. Deploy MemoriWA di VPS
2. Buka dashboard → halaman Connect → klik **Start & Show QR**
3. Scan QR code dengan WhatsApp di HP Anda
4. WhatsApp terhubung → status "Connected"
5. Kirim dokumen/gambar ke nomor Anda → otomatis muncul di Inbox
6. Analisis file dengan AI (manual trigger)

**WAHA** (WhatsApp HTTP API) berjalan sebagai container yang menangani koneksi WhatsApp via Chromium headless (seperti WhatsApp Web). MemoriWA terhubung ke WAHA melalui Docker network internal. Semua pesan dikirim via webhook.

---

## 📋 Prasyarat

| Kebutuhan | Minimal | Rekomendasi |
|---|---|---|
| **CPU** | 1 core | 2+ core |
| **RAM** | 2 GB | 4 GB |
| **Disk** | 20 GB | 40 GB SSD |
| **OS** | Ubuntu 20.04+ | Ubuntu 24.04 LTS |
| **Software** | Docker + Docker Compose | — |
| **Port** | 8082 | — |

> ⚠️ WAHA menjalankan Chromium headless. RAM 2GB minimum.

---

## 🚀 Instalasi Cepat

### 1. Install Docker
```bash
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker $USER
newgrp docker
```

### 2. Clone & Konfigurasi
```bash
git clone https://github.com/KaryaPutraS/memoriwa.git
cd memoriwa/backend
cp .env.example .env
nano .env
```

Isi `.env`:
```env
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=password-aman-anda
WAHA_API_KEY=api-key-bebas-minimal-16-karakter
MEMORIWA_WEBHOOK_URL=http://IP_VPS_ANDA:8082/webhook/waha
```

### 3. Jalankan
```bash
docker compose up -d --build
```

### 4. Akses
```
http://IP_VPS_ANDA:8082
```
Login, buka **Connect** → **Start & Show QR** → scan dengan WhatsApp.

---

## ⚙️ Konfigurasi Environment

| Variable | Wajib | Deskripsi |
|---|---|---|
| `JWT_SECRET` | ✅ | Secret JWT token (min 32 karakter) |
| `ADMIN_USERNAME` | ❌ | Username login (default: admin) |
| `ADMIN_PASSWORD` | ✅ | Password login |
| `WAHA_API_KEY` | ✅ | API key untuk koneksi ke WAHA |
| `MEMORIWA_WEBHOOK_URL` | ✅ | URL webhook WAHA |
| `CORS_ORIGINS` | ❌ | Origins CORS (default: localhost:5173) |
| `WEBHOOK_SECRET` | ❌ | Secret validasi webhook (opsional) |
| `ENABLE_DOCS` | ❌ | Aktifkan Swagger UI (true/false) |
| `RATE_LIMIT_MAX` | ❌ | Max request/menit/IP (default: 200) |

---

## 📚 Panduan Penggunaan

### Koneksi WhatsApp
1. Login → **Connect** → **Start & Show QR**
2. QR muncul → WhatsApp HP → Settings → Linked Devices → Scan
3. Status "Connected" — selesai

### Menerima Dokumen
Kirim PDF, DOCX, XLSX, PPTX, TXT, CSV, JPG, PNG, WEBP ke nomor WhatsApp Anda dari nomor lain. File muncul di **Inbox**.

### Analisis AI
1. **Settings → AI Engine** → tambah provider (pilih dari dropdown, isi API key)
2. **Inbox** → centang file → klik **Analyze**

### Manajemen File
- **Inbox**: filter by type/status
- **File Manager**: browse by AI category
- **Stats**: grafik volume dan status

---

## ❓ FAQ

**Q: Kenapa hanya 1 nomor?**
A: Single-tenant = setiap orang deploy sendiri. Aman, tidak ada conflict.

**Q: Apakah aman?**
A: WAHA menggunakan WhatsApp Web. Nomor Anda tetap di HP. Tidak ada password WhatsApp yang disimpan.

**Q: Bisa kena banned?**
A: Risiko kecil. Gunakan nomor secondary/bisnis.

**Q: Biaya?**
A: VPS ~$12/bulan. AI provider sesuai pemakaian.

---

## 🔧 Troubleshooting

| Masalah | Solusi |
|---|---|
| QR tidak muncul | `docker compose restart waha` |
| Dokumen tidak masuk | Cek status Connected; jangan forward |
| Login gagal | `cat .env \| grep ADMIN`; restart api |
| Container error | `docker compose logs api` |

---

## 💻 Tech Stack

FastAPI · React 19 · TypeScript · Docker · WAHA · Nginx · WebSocket · JWT · Fernet

---

## 🧑‍💻 Development

```bash
# Backend
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8002

# Frontend
cd frontend && npm install && npm run dev

# Tests
cd backend && pytest -q
```

---

## 📄 Lisensi

MIT — bebas untuk pribadi dan komersial.

**Dibuat oleh [KaryaPutraS](https://github.com/KaryaPutraS)**
