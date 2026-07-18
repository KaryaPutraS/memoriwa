# WA Document & Image Intelligence Dashboard

A FastAPI + React/Tailwind dashboard for WhatsApp document/image intake through WAHA.

## Run backend

```bash
cd backend
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Run frontend

```bash
cd frontend
npm install
npm run dev
```

Set `VITE_API_URL` and `VITE_WS_URL` when connecting the UI to a deployed backend.

The webhook intentionally stores only document/image messages and does not start analysis automatically. Analysis is queued only from authenticated dashboard actions.
