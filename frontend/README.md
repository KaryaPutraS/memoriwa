# WA Document & Image Intelligence Dashboard

Vite + React + TypeScript + Tailwind frontend for AdminPintar. Configure `VITE_API_URL` and `VITE_WS_URL`; the UI falls back to mock data when the backend is unavailable. File arrival does not trigger analysis automatically: analysis is only initiated by the explicit Analyze action.

```bash
npm install
npm run dev
npm run typecheck
npm run build
```