# Backend

FastAPI API for WAHA webhook intake, authenticated file operations, manual analysis queue, provider/settings configuration, statistics, and WebSocket events.

The current local adapter uses an in-process store so the API and tests run without MongoDB; `MONGO_URI` is reserved for the Mongo-compatible persistence adapter in deployment.

```bash
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
python -m pytest -q tests/test_api.py
```
