# AMA-Chatbot-Alle-Merken — Architecture & Documentation

A Flask-based Q&A chatbot that lets users ask questions about the mortgage acceptance
policies ("acceptatiegidsen") of four Dutch mortgage brands, either one at a time or
compared across all brands at once.

![System Overview](system-overview.png)

## 1. Tech Stack

| Layer | Technology |
|---|---|
| Web framework | Flask + Gunicorn (production) |
| LLM | OpenAI `gpt-4.1` via `langchain.chat_models.init_chat_model` |
| Embeddings | OpenAI `text-embedding-3-large` (3072 dimensions) |
| Vector store | Pinecone (serverless, AWS `us-east-1`) |
| Agent framework | LangGraph `create_react_agent` (ReAct pattern) |
| PDF ingestion | `PyPDFLoader` + `RecursiveCharacterTextSplitter` |
| Parallelism | `concurrent.futures.ThreadPoolExecutor` |

## 2. Repository Structure

app.py → Flask app, agent orchestration, API routes
ingest.py → One-off script to embed brand PDFs into Pinecone
brands.py → Static config: brand metadata + PDF paths
requirements.txt → Python dependencies
Dockerfile → Container build (gunicorn entrypoint)
templates/ → HTML template(s) for the chat UI
static/ → JS, CSS, brand PDFs

## 3. Data Model: Brands

`brands.py` defines a single dict, `BRANDS`, keyed by a short brand code
(`cbleef`, `attens`, `syntrus`, `cbwoningverhuur`). Each entry holds display
metadata (`name`, `color`, `accent`, `icon`) and a `pdf_url` pointing to the
brand's acceptance policy PDF under `static/pdfs/`.

This dict is the single source of truth used by:
- `ingest.py` — which PDF to embed, and how to tag its chunks
- `app.py` — which agent to build/cache per brand, and what the frontend renders

Adding a new brand only requires adding one entry here (plus dropping its PDF
in `static/pdfs/`) — no other code needs to change, as long as you re-run
`ingest.py`.

## 4. Ingestion Pipeline (`ingest.py`)

Run manually, offline, whenever a policy PDF is added or updated. Not called
by the running app.

For each brand in BRANDS:
- Load PDF
- Split into chunks(chunk_size=1000, chunk_overlap=200, add_start_index=True)
- Tag every chunk: metadata["brand"] = brand_key
- Embed + upsert into Pinecone


Key details: (created by llm, not checked by me **yet**)
- **Index creation is idempotent**: it checks `pc.list_indexes()` and only
  creates `hypotheek-docs` if it doesn't already exist.
- **`dimension=3072`** must match `text-embedding-3-large`'s output size — if
  you ever change the embedding model, the index must be deleted and recreated.
- **The `brand` metadata tag** is what makes multi-tenant retrieval possible:
  a single shared index holds all four brands' chunks, distinguished only by
  this filter field.
- Chunking parameters (1000/200) are the same for every brand — no per-brand
  tuning currently exists.

## 5. Runtime Architecture (`app.py`)

### 5.1 Startup (module load time)

```python
model        = init_chat_model("gpt-4.1")
embeddings   = OpenAIEmbeddings(model="text-embedding-3-large")
vector_store = PineconeVectorStore(index_name=INDEX_NAME, embedding=embeddings)
agent_cache  = {key: make_agent(key) for key in BRANDS}
```

One ReAct agent is built **per brand** and cached in a dict at import time —
not per request. This avoids rebuilding the agent (and its bound tool/prompt)
on every call, at the cost of holding 4 agent objects in memory permanently.

### 5.2 Per-brand agent factory: `make_agent(brand_key)`

Each agent gets exactly one tool, `retrieve_context`, which is a closure over
that brand's key:

```python
@tool(response_format="content_and_artifact")
def retrieve_context(query: str):
    docs = vector_store.similarity_search(query, k=3, filter={"brand": brand_key})
    serialized = "\n\n".join(f"Source: {doc.metadata}\nContent: {doc.page_content}" for doc in docs)
    return serialized, docs
```

- `response_format="content_and_artifact"` lets the tool return **two**
  things: a string (`content`, what the LLM sees/reasons over) and the raw
  `docs` objects (`artifact`, kept out of the LLM's context but retrievable
  by the app afterward — this is how page numbers get extracted later).
- `k=3` — always retrieves the top 3 chunks for that brand, no reranking.
- The agent's system prompt (built per-brand) instructs the model to:
  - only use the tool to answer,
  - cite sources as `(pagina X)` in a strict, exact format,
  - answer in the same language as the question.

The strict citation-format instruction exists because `_extract_pages()`
later parses the answer text with a regex looking for exactly that pattern —
if the model deviates, page extraction silently returns nothing.

### 5.3 The ReAct loop

User question
│
▼
LLM reasons: "do I need to look something up?"
│
├─ Yes → calls retrieve_context(query) → gets chunks back → reasons again
│
└─ No / has enough info → produces final answer (with page citations)

### 5.4 Page number extraction: `_extract_pages()`

```python
re.findall(r'\(([^)]*pagina[^)]+)\)', final_answer, re.IGNORECASE)
```

(LLM text)
Pulls every `(pagina N[, pagina M ...])` citation out of the **answer text
itself** — not from the retrieved chunks' metadata. The code comment
explains why: Pinecone chunk metadata stores physical (0-indexed) PDF page
numbers, which don't match the printed page numbers a human reader sees in
the PDF. So the app trusts the LLM's citation instead of the retrieval
metadata. This is elegant but fragile — see §7.

### 5.5 API Routes

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | Renders `index.html`, injecting brand metadata as JSON for the frontend |
| `/ask` | POST | Single-brand Q&A. Body: `{query, brand}` → `{answer, pages}` |
| `/ask-all` | POST | Multi-brand comparison. Body: `{query}` → `{synthesis, brands}` |

![Ask-all fan-out to Pinecone](brand isolation.pdf)


## 6. End-to-End Flow Diagrams

## 7. Known Risks & Production Considerations (only LLM text atm)

These are worth documenting explicitly rather than silently fixing, since
they're useful both as a learning artifact and as a pre-deployment checklist.

- **`app.run(debug=True, port=5050)`** — only executed when running
  `python app.py` directly; the Dockerfile actually runs via `gunicorn`, so
  this specific risk doesn't apply to the containerized deployment. It *is*
  a risk if anyone runs the file directly in a shared environment (Flask
  debugger allows arbitrary code execution).
- **No authentication or rate limiting** on `/ask` or `/ask-all` — anyone
  with network access can make unlimited calls, each of which costs OpenAI +
  Pinecone usage. Worth adding an API key check or reverse-proxy auth before
  any public deployment.
- **Raw exception messages returned to the client**: `except Exception as e: ... jsonify({"answer": f"Fout: {str(e)}"})`. This can leak internal details
  (stack traces indirectly, library error text, occasionally file paths or
  config hints) to end users. Should log the full traceback server-side (already
  done via `traceback.print_exc()`) but return a generic message to the client.
- **Citation format is a brittle contract**: page-number extraction depends
  entirely on the LLM reliably following the `(pagina X)` instruction. If the
  model ever answers in a slightly different format, `pages` silently comes
  back empty with no error or fallback.
- **`gunicorn --workers 1`**: only one worker process. Under concurrent load,
  requests queue up rather than running in parallel across processes (the
  `ThreadPoolExecutor` in `/ask-all` only parallelizes *within* one request,
  across brands — not across different users' requests).
- **Code duplication** between `/ask`'s inline logic and `run_brand_agent()` —
  the same streaming/extraction logic exists in two places and could drift
  out of sync if one is updated and not the other.
- **No retry/timeout handling** around OpenAI or Pinecone calls — a slow or
  failing external API call will hang the request up to Gunicorn's configured
  timeout (120s per the Dockerfile), then fail with a generic error.
- **Global mutable state at import time** (`agent_cache`, `vector_store`,
  `model`) — fine for a single-process app, but means adding a brand requires
  a full app restart (agents aren't rebuilt at runtime).
- **Citation regex duplicated across backend and frontend**: `app.py`'s
  `_extract_pages()` and `main.js`'s `extractPages()` implement the same
  `(pagina X)` parsing logic independently, in two languages. If the
  citation format ever changes, both copies need updating — there's no
  single source of truth, so they can silently drift out of sync.


## 8. Frontend (`templates/index.html`, `static/main.js`) (only LLM text atm)

### 8.1 Brand data injection

`app.py`'s `/` route serializes brand metadata to JSON and injects it directly
into the page as a global variable: `const BRANDS = {{ brands_json | safe }};`.
`main.js` builds the entire sidebar from this object at page load — no brand
list is hardcoded in the HTML itself.

### 8.2 Brand selection state

A single global `activeBrand` variable tracks the current mode:
- A brand key (e.g. `"attens"`) → single-brand mode
- `"__all__"` → all-brands comparison mode

`selectBrand(key)` and `selectAllBrands()` both recolor the header to match
the brand (or a neutral dark theme for all-brands mode), enable the question
textarea, and collapse the sidebar on mobile after selection.

### 8.3 Sending a question

`sendMessage()` branches on `activeBrand`:
- `"__all__"` → `POST /ask-all` with `{query}`, rendered via `addAllBrandsMessage()`
- any brand key → `POST /ask` with `{query, brand}`, rendered via `addMessage()`

### 8.4 Page citations and PDF navigation

- The PDF itself renders client-side via a bundled PDF.js viewer in an
  iframe: `/static/pdfjs/web/viewer.html?file=...#page=N`. (This means
  `static/pdfjs/` is a vendored dependency in the repo, not visible in a
  top-level file listing.)
- Every `(pagina X)` citation inside an AI answer is turned into a clickable
  inline tag by `formatAnswer()`, and a row of "Pagina X" buttons is
  rendered below the answer by `buildPageButtons()`. Both call
  `jumpToPage(page, brandKey)`, which opens the PDF panel (if closed) and
  reloads the iframe at that page.
- **Auto-jump is conditional, not automatic**: `if (pages.length > 0 &&
  pdfOpen) jumpToPage(pages[0])` — the app only auto-navigates to the first
  cited page if the PDF panel was already open when the answer arrived. It
  does not force the panel open on every answer.
- **Duplicated citation-parsing logic**: `main.js` has its own `extractPages()`,
  a JavaScript re-implementation of the same regex used in `app.py`'s
  `_extract_pages()`. It's used as a fallback: `data.pages && data.pages.length
  ? data.pages : extractPages(data.answer)`.

### 8.5 All-brands comparison UI

`addAllBrandsMessage()` renders the `/ask-all` response as: the synthesis
text at the top, followed by a collapsible `<details>` accordion, one per
brand, each with its own page-jump buttons. Two extra client-only features
exist in this mode:
- **Export to PDF** (`exportAllBrandsToPdf`) — builds a standalone,
  print-styled HTML document in-browser and opens it in a new tab, then
  calls `window.print()`. No server round-trip.
- **Compose email** (`composeAllBrandsEmail`) — strips the HTML down to
  plain text and opens a `mailto:` link with the comparison pre-filled as
  the body.

### 8.6 Answer formatting

`formatAnswer()` does a small hand-rolled Markdown-to-HTML conversion
(bold, italic, headers, bullet lists, horizontal rules, and a custom
Markdown table parser). There is no Markdown library on the frontend.

## 9. Glossary (quick reference) (Only LLM text atm)

- **RAG (Retrieval-Augmented Generation)**: instead of relying only on the
  LLM's trained knowledge, relevant text chunks are retrieved from a vector
  database and injected into the prompt/context before the LLM answers.
- **ReAct agent**: an LLM wrapped in a loop that can decide, turn by turn,
  whether to call a tool (here: `retrieve_context`) or produce a final
  answer, based on its own reasoning.
- **Embedding**: a numeric vector representation of text such that
  semantically similar text has vectors that are close together — this is
  what makes similarity search possible.
- **Vector store / Pinecone index**: a database optimized for storing
  embeddings and finding the nearest ones to a query embedding.
- **`content_and_artifact`**: a LangChain tool response mode returning both
  a string for the LLM and a separate Python object for the calling code —
  used here so the app can access raw retrieved `Document`s without putting
  them in the LLM's context window.
