"""Document analysis pipeline — all-free strategy.

1. Digital PDFs  -> text-layer extraction with PyMuPDF (local, private).
2. Images/scans  -> Groq vision model (llama-4-scout, free tier).
3. Offline fallback -> Tesseract OCR (CPU, no API key needed).

After extraction a text-only LLM call builds a searchable "identity"
(title, type, date, parties, summary, tags, language) which is stored in
the document metadata so the existing ?q= search can find files by content.
"""
from __future__ import annotations
import base64, json, logging, os, subprocess
from typing import Any
from urllib.parse import urlparse

import httpx

import app.auth as auth

logger = logging.getLogger("memoriwa.analysis")

GROQ_BASE = "https://api.groq.com/openai/v1"
GROQ_OCR_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
GROQ_TEXT_MODEL = "llama-3.3-70b-versatile"

MAX_PDF_PAGES = 3          # pages sent to the vision model per document
MIN_TEXT_LAYER = 50        # chars — below this a PDF is treated as scanned
MAX_STORED_TEXT = 20000    # chars of extracted text kept in metadata

ALLOWED_FETCH_HOSTS = {"localhost:3000", "127.0.0.1:3000", "waha:3000"}

OCR_PROMPT = (
    "Transcribe this document page into clean plain text (use Markdown tables "
    "where helpful). Keep the original language. Output ONLY the transcription."
)

IDENTITY_PROMPT = """You are given the text content of a document. Produce a JSON object with exactly these keys:
- "title": short descriptive title (max 80 chars)
- "doc_type": specific document type, 1-3 lowercase words in the document's own language (e.g. invoice, kwitansi, surat perjanjian, tiket perjalanan, kartu identitas). Avoid generic words like "document" or "other"; use "other" only as a last resort
- "date": main document date as YYYY-MM-DD, or "" if unknown
- "parties": list of up to 5 people/organizations mentioned
- "summary": 1-2 sentence summary in the document's own language
- "tags": list of 3-8 lowercase search keywords (names, doc type, key terms)
- "language": ISO 639-1 code
Respond with ONLY the JSON object, no markdown fences, no commentary.

DOCUMENT TEXT:
"""

CAPTION_IDENTITY_PROMPT = """You are given the text of a WhatsApp activity report (usually Indonesian, often starting with greetings like "Assalamualaikum", "izin melaporkan", "mohon ijin"). It is the caption of a set of activity photos. Produce a JSON object with exactly these keys:
- "title": short activity title, max 8 words, WITHOUT any greeting or reporting filler — just the activity itself (e.g. "Apel Pagi Komandan Pers Bid TIK", "Piket Senkom dan Pengamanan Mako")
- "doc_type": the activity type, 1-3 lowercase words (e.g. "apel pagi", "piket senkom", "rapat koordinasi", "pengamanan")
- "summary": 1 sentence summary in Indonesian, without greetings
- "tags": list of 3-6 lowercase keywords (activity, unit/organization, people, place)
- "language": ISO 639-1 code
Respond with ONLY the JSON object, no markdown fences, no commentary.

REPORT TEXT:
"""


# ---------- LLM configuration ----------

async def _llm_config(repo) -> dict | None:
    """Resolve which OpenAI-compatible endpoint to use.

    Priority: active provider configured in the dashboard -> GROQ_API_KEY env.
    """
    for p in await repo.get_providers():
        if p.get("active") and p.get("api_key"):
            key = auth.decrypt_api_key(p["api_key"])
            if key:
                kind = p.get("kind", "custom")
                return {
                    "base_url": (p.get("base_url") or GROQ_BASE).rstrip("/"),
                    "api_key": key,
                    # Vision OCR needs a dedicated vision model for Groq;
                    # other providers use their configured model for both.
                    "ocr_model": GROQ_OCR_MODEL if kind == "groq" else (p.get("model") or GROQ_OCR_MODEL),
                    # Identity/summary always uses the model chosen in Settings.
                    "text_model": p.get("model") or GROQ_TEXT_MODEL,
                }
    env_key = os.getenv("GROQ_API_KEY", "")
    if env_key:
        return {"base_url": GROQ_BASE, "api_key": env_key,
                "ocr_model": GROQ_OCR_MODEL, "text_model": GROQ_TEXT_MODEL}
    return None


async def _vision_config(repo) -> dict | None:
    """Dedicated vision/OCR endpoint configured in Settings -> AI.

    When set, this overrides the active provider for image OCR only;
    identity/summary still uses _llm_config(). Defaults: Groq base URL and
    the Groq vision model, so only an API key is strictly required.
    """
    s = await repo.get_settings() or {}
    token = s.get("vision_api_key") or ""
    if not token:
        return None
    key = auth.decrypt_api_key(token)
    if not key:
        return None
    return {
        "base_url": (s.get("vision_base_url") or GROQ_BASE).rstrip("/"),
        "api_key": key,
        "ocr_model": s.get("vision_model") or GROQ_OCR_MODEL,
        # extract_text only reads ocr_model/base_url/api_key; text_model is
        # unused here but kept for shape compatibility with _llm_config().
        "text_model": GROQ_TEXT_MODEL,
    }


async def _chat(cfg: dict, model: str, messages: list, max_tokens: int = 2048) -> str:
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{cfg['base_url']}/chat/completions",
            headers={"Authorization": f"Bearer {cfg['api_key']}"},
            json={"model": model, "messages": messages, "temperature": 0.1, "max_tokens": max_tokens},
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


# ---------- File fetching (same SSRF rules as the download proxy) ----------

async def fetch_doc_bytes(doc: dict, waha) -> bytes:
    meta = doc.get("metadata") or {}
    local_path = meta.get("local_path") or doc.get("local_path")
    if local_path and os.path.exists(local_path):
        try:
            with open(local_path, "rb") as f:
                return f.read()
        except Exception as e:
            logger.warning("Reading local file failed for doc %s: %s", doc.get("id"), e)

    file_url = doc.get("file_url") or doc.get("url") or ""
    if not file_url:
        return b""
    if waha is None and not file_url.startswith("http"):
        return b""

    parsed = urlparse(file_url.replace("http://localhost:3000", "http://waha:3000"))
    if parsed.scheme != "http" or parsed.netloc not in ALLOWED_FETCH_HOSTS:
        logger.warning("Blocked non-WAHA fetch for doc %s", doc.get("id"))
        return b""
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.get(parsed.geturl(), headers=waha._headers(), follow_redirects=False)
            if r.status_code == 200 and len(r.content) > 100:
                return r.content
    except Exception as e:
        logger.warning("Fetch failed for doc %s: %s", doc.get("id"), e)
    return b""


# ---------- Text extraction ----------

def pdf_text_layer(data: bytes) -> str:
    import fitz  # PyMuPDF
    parts: list[str] = []
    with fitz.open(stream=data, filetype="pdf") as pdf:
        for page in pdf:
            parts.append(page.get_text())
    return "\n".join(parts).strip()


def pdf_page_images(data: bytes, max_pages: int = MAX_PDF_PAGES) -> list[bytes]:
    import fitz
    images: list[bytes] = []
    with fitz.open(stream=data, filetype="pdf") as pdf:
        for page in pdf[:max_pages]:
            pix = page.get_pixmap(dpi=150)
            images.append(pix.tobytes("png"))
    return images


def _tesseract(image_bytes: bytes) -> str:
    try:
        p = subprocess.run(
            ["tesseract", "stdin", "stdout", "-l", "ind+eng"],
            input=image_bytes, capture_output=True, timeout=90,
        )
        return p.stdout.decode("utf-8", "ignore").strip()
    except Exception as e:
        logger.warning("Tesseract failed: %s", e)
        return ""


async def _ocr_image_groq(image_bytes: bytes, mime: str, cfg: dict) -> str:
    b64 = base64.b64encode(image_bytes).decode()
    return await _chat(cfg, cfg["ocr_model"], [{
        "role": "user",
        "content": [
            {"type": "text", "text": OCR_PROMPT},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
        ],
    }], max_tokens=4096)


def office_text(data: bytes, mime: str, filename: str = "") -> str:
    """Dependency-free text extraction from OOXML files (docx/pptx/xlsx)."""
    import zipfile, io, re, html
    fname = filename.lower()
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except Exception:
        return ""
    if "wordprocessingml" in mime or fname.endswith(".docx"):
        names = [n for n in zf.namelist() if n == "word/document.xml"]
        tag = "w:t"
    elif "presentationml" in mime or fname.endswith(".pptx"):
        names = sorted(n for n in zf.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n))
        tag = "a:t"
    elif "spreadsheetml" in mime or fname.endswith(".xlsx"):
        names = [n for n in zf.namelist() if n == "xl/sharedStrings.xml" or re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)]
        tag = "(?:t|v)"
    else:
        return ""
    pat = re.compile(rf"<{tag}(?:\s[^>]*)?>(.*?)</{tag}>", re.S)
    parts: list[str] = []
    for n in names:
        try:
            xml = zf.read(n).decode("utf-8", "ignore")
        except Exception:
            continue
        texts = [html.unescape(t) for t in pat.findall(xml) if t.strip()]
        if texts:
            parts.append(" ".join(texts))
    return "\n\n".join(parts).strip()


async def extract_text(data: bytes, mime: str, cfg: dict | None, filename: str = "") -> tuple[str, str]:
    """Returns (text, method). Never raises on OCR failure — returns what it got."""
    fname = filename.lower()
    if mime == "application/pdf" or fname.endswith(".pdf"):
        text = pdf_text_layer(data)
        if len(text) >= MIN_TEXT_LAYER:
            return text, "pdf-text"
        pages = pdf_page_images(data)
        if cfg:
            try:
                parts = [await _ocr_image_groq(p, "image/png", cfg) for p in pages]
                text = "\n\n".join(t for t in parts if t and t.strip())
                if text.strip():
                    return text, "groq-vision"
            except Exception as e:
                logger.warning("Groq vision OCR failed, falling back to tesseract: %s", e)
        return "\n\n".join(_tesseract(p) for p in pages), "tesseract"
    if mime.startswith("image/") or any(fname.endswith(ext) for ext in [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]):
        if cfg:
            try:
                text = await _ocr_image_groq(data, mime, cfg)
                if text.strip():
                    return text, "groq-vision"
            except Exception as e:
                logger.warning("Groq vision OCR failed, falling back to tesseract: %s", e)
        return _tesseract(data), "tesseract"
    if "officedocument" in mime or any(fname.endswith(ext) for ext in [".docx", ".xlsx", ".pptx"]):
        text = office_text(data, mime, filename)
        return (text, "office-text") if text else ("", "unsupported")
    if mime.startswith("text/") or any(fname.endswith(ext) for ext in [".txt", ".csv", ".tsv", ".json", ".xml", ".html", ".md", ".log", ".yaml", ".yml"]):
        try:
            return data.decode("utf-8", "ignore").strip(), "plain-text"
        except Exception:
            pass
    return "", "unsupported"


# ---------- Identity building ----------

def parse_identity(raw: str) -> dict:
    """Tolerant JSON extraction from LLM output (handles prose/fences)."""
    i, j = raw.find("{"), raw.rfind("}")
    if i == -1 or j <= i:
        raise ValueError("no JSON object in model output")
    obj = json.loads(raw[i:j + 1])
    keys = ("title", "doc_type", "date", "parties", "summary", "tags", "language")
    return {k: obj[k] for k in keys if obj.get(k) not in (None, "", [])}


async def build_identity(text: str, cfg: dict) -> dict:
    msgs = [{"role": "user", "content": IDENTITY_PROMPT + text[:12000]}]
    raw = await _chat(cfg, cfg["text_model"], msgs, max_tokens=1024)
    try:
        return parse_identity(raw)
    except ValueError:
        # One retry with an explicit JSON-only instruction.
        raw = await _chat(cfg, cfg["text_model"], [
            {"role": "system", "content": "You answer with a single raw JSON object only — no prose, no markdown."},
            *msgs,
        ], max_tokens=1024)
        return parse_identity(raw)


import re

# Greeting / reporting-filler prefixes common in Indonesian activity reports.
_GREETING = re.compile(
    r"^(?:[\s\u200e\u200f,.:;!-]*(?:assalamu['\"]?alaikum|wr\.?\s*wb\.?|selamat\s+(?:pagi|siang|sore|malam)|"
    r"komandan|bapak|ibu|pak|mohon\s+i+j?in|i+j?in\s+melaporkan|izin\s+melaporkan|melaporkan|"
    r"salam\s+sejahtera|yang\s+terhormat|yth\.?)\b[\s\u200e\u200f,.:;!-]*)+",
    re.IGNORECASE)
_STOPWORDS = {"dan", "yang", "di", "ke", "dari", "the", "a", "an", "of", "to", "giat",
              "kegiatan", "situasi", "aman", "lancar", "kondusif", "dum", "dokumentasi",
              "laporan", "hasil", "saat", "ini", "tersebut", "pada", "hari", "tanggal",
              "jam", "pukul", "wib"}


def _caption_fallback(caption: str) -> dict:
    """Deterministic identity for when the model keeps answering prose:
    strip the greeting/reporting prefix and keep the activity keywords."""
    core = _GREETING.sub("", caption or "").strip()
    core = re.sub(r"\s+", " ", core).strip(" .,")
    words = core.split(" ") if core else []
    title = " ".join(words[:8]) or (caption or "Dokumentasi")[:80]
    sig = [re.sub(r"[\u200e\u200f]", "", w).strip(".,;:!?()").lower() for w in words]
    sig = [w for w in sig if len(w) > 2 and w not in _STOPWORDS and not w.isdigit()]
    doc_type = " ".join(sig[:2]) if sig else "dokumentasi kegiatan"
    seen: set[str] = set()
    tags: list[str] = []
    for w in sig:
        if w not in seen:
            seen.add(w)
            tags.append(w)
        if len(tags) >= 6:
            break
    return {"title": title, "doc_type": doc_type, "summary": (core or caption or "")[:200], "tags": tags}


async def caption_identity(repo, caption: str) -> dict | None:
    """Clean identity (title/tags/doc_type) for a photo burst, extracted by the
    configured AI from the raw WhatsApp caption/report text.

    Returns None when no AI provider is configured or the call fails — the
    caller then keeps the raw caption as the title. When the model answers
    prose instead of JSON twice, a deterministic greeting-stripping fallback
    still produces a usable identity.
    """
    cfg = await _llm_config(repo)
    if not cfg:
        return None
    msgs = [{"role": "user", "content": CAPTION_IDENTITY_PROMPT + caption[:2000]}]
    try:
        raw = await _chat(cfg, cfg["text_model"], msgs, max_tokens=400)
        try:
            return parse_identity(raw)
        except ValueError:
            raw = await _chat(cfg, cfg["text_model"], [
                {"role": "system", "content": "You answer with a single raw JSON object only — no prose, no markdown."},
                *msgs,
            ], max_tokens=400)
            try:
                return parse_identity(raw)
            except ValueError:
                logger.warning("Caption identity: model kept answering prose — heuristic fallback used")
                return _caption_fallback(caption)
    except Exception as e:
        logger.warning("Caption identity failed: %s", e)
        return None


# ---------- Orchestration ----------

async def analyze_document(doc: dict, waha, repo, on_update=None) -> dict:
    """Run the full pipeline on one document; persists status + metadata.

    on_update (optional async callback) is invoked after every stage so
    callers can push live progress (metadata.progress, 0-100) to clients.
    """
    doc_id = doc["id"]
    meta = dict(doc.get("metadata") or {})

    async def _progress(pct: int) -> None:
        meta["progress"] = pct
        doc["metadata"] = meta
        await repo.update_document(doc_id, doc)
        if on_update:
            await on_update(doc)

    try:
        cfg = await _llm_config(repo)
        ocr_cfg = (await _vision_config(repo)) or cfg
        await _progress(10)
        data = await fetch_doc_bytes(doc, waha)
        if not data:
            raise RuntimeError("file bytes unavailable")
        await _progress(35)
        text, method = await extract_text(data, doc.get("mime_type", ""), ocr_cfg, doc.get("filename", ""))
        meta["extraction_method"] = method
        meta["extracted_text"] = text[:MAX_STORED_TEXT]
        if not text.strip():
            if doc.get("mime_type", "").startswith("image/"):
                # A photo without readable text is not a failure — file it
                # with a minimal identity so it leaves the Inbox queue.
                meta["identity"] = {
                    "title": doc.get("filename") or meta.get("caption") or "Image",
                    "doc_type": "image",
                    "summary": "Gambar tanpa teks yang dapat dibaca.",
                    "tags": ["gambar", "foto"],
                }
                doc["status"] = "analyzed"
                await _progress(100)
                return doc
            raise RuntimeError(f"no text extracted (method={method})")
        await _progress(65)
        if cfg:
            try:
                meta["identity"] = await build_identity(text, cfg)
            except Exception as e:
                logger.warning("Identity build failed for %s: %s", doc_id, e)
                meta["identity_error"] = str(e)[:200]
        doc["status"] = "analyzed"
        await _progress(100)
        return doc
    except Exception as e:
        logger.warning("Analysis failed for %s: %s", doc_id, e)
        meta["analysis_error"] = str(e)[:300]
        doc["status"] = "failed"
    doc["metadata"] = meta
    await repo.update_document(doc_id, doc)
    if on_update:
        await on_update(doc)
    return doc


import math
import re

def compute_hybrid_relevance(query: str, documents: list[dict]) -> list[dict]:
    """Compute hybrid semantic & BM25/n-gram relevance score for documents given a query string.
    
    Returns documents with added 'relevance_score' and 'match_highlights' in metadata, sorted by relevance.
    """
    if not query or not query.strip():
        return documents
        
    q_clean = query.strip().lower()
    q_words = set(re.findall(r'\w+', q_clean))
    if not q_words:
        return documents

    def _extract_doc_text(doc: dict) -> tuple[str, list[tuple[str, float]]]:
        meta = doc.get("metadata") or {}
        ident = meta.get("identity") or {}
        title = str(ident.get("title") or doc.get("filename") or "")
        summary = str(ident.get("summary") or meta.get("explanation") or meta.get("caption") or "")
        tags = " ".join(ident.get("tags") or [])
        doc_type = str(ident.get("doc_type") or "")
        parties = " ".join(ident.get("parties") or [])
        extracted = str(meta.get("extracted_text") or "")
        sender = str(doc.get("sender") or "")
        filename = str(doc.get("filename") or "")
        
        weighted_parts: list[tuple[str, float]] = [
            (title, 3.0),
            (summary, 2.0),
            (tags, 2.0),
            (doc_type, 2.0),
            (parties, 1.5),
            (filename, 1.5),
            (sender, 1.0),
            (extracted, 1.0),
        ]
        full_text = f"{title} {summary} {tags} {doc_type} {parties} {filename} {sender} {extracted}".lower()
        return full_text, weighted_parts

    scored_docs = []
    for doc in documents:
        full_text, weighted_parts = _extract_doc_text(doc)
        doc_words = set(re.findall(r'\w+', full_text))
        
        if not doc_words:
            scored_doc = dict(doc)
            meta_c = dict(scored_doc.get("metadata") or {})
            meta_c["relevance_score"] = 0.0
            scored_doc["metadata"] = meta_c
            scored_docs.append((0.0, scored_doc))
            continue
            
        exact_bonus = 0.35 if q_clean in full_text else 0.0
        
        score_acc = 0.0
        max_possible = 0.0
        highlights = []
        
        for text, weight in weighted_parts:
            if not text:
                continue
            text_lower = text.lower()
            field_words = set(re.findall(r'\w+', text_lower))
            overlap = q_words.intersection(field_words)
            if overlap:
                field_score = (len(overlap) / len(q_words)) * weight
                score_acc += field_score
                max_possible += weight
                for word in overlap:
                    if word not in highlights and len(word) > 2:
                        highlights.append(word)
                        
        if max_possible == 0:
            max_possible = 1.0
            
        base_score = min(1.0, (score_acc / max_possible) + exact_bonus)
        
        max_tokens_q = len(q_words)
        char_overlap = 0.0
        for qw in q_words:
            if any(qw in dw or dw in qw for dw in doc_words if len(dw) >= 3):
                char_overlap += 1.0
        ngram_bonus = 0.25 * (char_overlap / max_tokens_q) if max_tokens_q > 0 else 0.0
        
        final_score = round(min(1.0, max(0.0, base_score + ngram_bonus)), 2)
        
        doc_copy = dict(doc)
        meta_copy = dict(doc_copy.get("metadata") or {})
        meta_copy["relevance_score"] = final_score
        meta_copy["match_highlights"] = highlights[:5]
        doc_copy["metadata"] = meta_copy
        
        if final_score > 0 or q_clean in full_text:
            scored_docs.append((final_score, doc_copy))
            
    scored_docs.sort(key=lambda x: x[0], reverse=True)
    return [d for _, d in scored_docs]

