from flask import Flask, request, jsonify, render_template
import os
import re
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from langchain.chat_models import init_chat_model
from langchain_openai import OpenAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from langchain.tools import tool
from langgraph.prebuilt import create_react_agent
from brands import BRANDS

# ── Environment ───────────────────────────────────────────────
INDEX_NAME = "hypotheek-docs"

# ── Model & Vector Store ──────────────────────────────────────
print("Connecting to model and Pinecone...")
model        = init_chat_model("gpt-4.1")
embeddings   = OpenAIEmbeddings(model="text-embedding-3-large")
vector_store = PineconeVectorStore(index_name=INDEX_NAME, embedding=embeddings)
print("Ready.")

# ── Per-brand retrieval tool factory ─────────────────────────
def make_agent(brand_key: str):
    brand = BRANDS[brand_key]

    @tool(response_format="content_and_artifact")
    def retrieve_context(query: str):
        """Retrieve information from the acceptance policy to answer a query."""
        docs = vector_store.similarity_search(
            query, k=3, filter={"brand": brand_key}
        )
        serialized = "\n\n".join(
            f"Source: {doc.metadata}\nContent: {doc.page_content}"
            for doc in docs
        )
        return serialized, docs

    prompt = (
        f"You have access to a tool that retrieves context from the acceptance policy of {brand['name']}, "
        f"a Dutch mortgage provider. Use the tool to answer user queries accurately. "
        f"Always cite the relevant section and page number from the policy. "
        f"Answer in the same language as the question."
    )
    return create_react_agent(model, [retrieve_context], prompt=prompt)

# Cache agents so they're not recreated on every request
agent_cache = {key: make_agent(key) for key in BRANDS}

# ── Flask ─────────────────────────────────────────────────────
app = Flask(__name__)


@app.route("/")
def index():
    brands_json = json.dumps({k: {
        "name":    v["name"],
        "color":   v["color"],
        "accent":  v["accent"],
        "icon":    v["icon"],
        "pdf_url": v["pdf_url"],
    } for k, v in BRANDS.items()})
    return render_template("index.html", brands_json=brands_json)


def extract_highlight_phrases(chunks: list[str]) -> list[str]:
    """
    Extract short, distinctive phrases from source chunks suitable for
    PDF.js text search highlighting. Takes up to 2 sentences per chunk
    to avoid overly long search strings that won't match due to line breaks
    in the PDF text layer.
    """
    phrases = []
    for chunk in chunks:
        # Normalise whitespace
        text = re.sub(r'\s+', ' ', chunk).strip()
        # Split on sentence boundaries
        sentences = re.split(r'(?<=[.!?])\s+', text)
        candidates = []
        if sentences:
            candidates.append(sentences[0])
        if len(sentences) > 2:
            candidates.append(sentences[len(sentences) // 2])
        for c in candidates:
            c = c.strip()
            # Long enough to be distinctive, short enough for PDF.js to match
            if 20 <= len(c) <= 200:
                phrases.append(c)
    return phrases


@app.route("/ask", methods=["POST"])
def ask():
    try:
        data      = request.get_json(force=True)
        query     = (data or {}).get("query", "").strip()
        brand_key = (data or {}).get("brand", "").strip()

        if not query:
            return jsonify({"answer": "Geen vraag ontvangen."}), 400
        if brand_key not in BRANDS:
            return jsonify({"answer": "Onbekend merk geselecteerd."}), 400

        print(f"\n[ASK] Brand={brand_key} Query={query}")
        agent = agent_cache[brand_key]

        final_answer = ""
        source_docs  = []
        for event in agent.stream(
            {"messages": [{"role": "user", "content": query}]},
            stream_mode="values",
        ):
            last = event["messages"][-1]
            if hasattr(last, "content") and last.content and getattr(last, "type", "") == "ai":
                if not getattr(last, "tool_calls", None):
                    final_answer = last.content
            if hasattr(last, "type") and last.type == "tool":
                if hasattr(last, "artifact") and last.artifact:
                    source_docs = last.artifact

        # Extract page numbers
        pages = []
        if source_docs:
            for doc in source_docs:
                p = doc.metadata.get("page")
                if p is not None:
                    pages.append(int(p) + 1)  # PyPDF is 0-indexed
        if not pages:
            matches = re.findall(r'[Pp]agina\s*(\d+)', final_answer)
            pages = [int(p) for p in matches]
        pages = sorted(set(pages))

        # Extract highlight phrases from the raw source chunks
        raw_chunks = [doc.page_content for doc in source_docs]
        highlight_phrases = extract_highlight_phrases(raw_chunks)

        print(f"[DONE] Returning answer ({len(final_answer)} chars), pages={pages}, phrases={len(highlight_phrases)}")
        return jsonify({
            "answer":  final_answer or "Geen antwoord ontvangen.",
            "pages":   pages,
            "chunks":  highlight_phrases,   # ← sent to frontend for PDF highlighting
        })

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"answer": f"Fout: {str(e)}"}), 500


def run_brand_agent(brand_key: str, query: str) -> dict:
    """Run a single brand agent and return its answer, pages, and highlight chunks."""
    agent = agent_cache[brand_key]
    final_answer = ""
    source_docs  = []

    for event in agent.stream(
        {"messages": [{"role": "user", "content": query}]},
        stream_mode="values",
    ):
        last = event["messages"][-1]
        if hasattr(last, "content") and last.content and getattr(last, "type", "") == "ai":
            if not getattr(last, "tool_calls", None):
                final_answer = last.content
        if hasattr(last, "type") and last.type == "tool":
            if hasattr(last, "artifact") and last.artifact:
                source_docs = last.artifact

    pages = []
    for doc in source_docs:
        p = doc.metadata.get("page")
        if p is not None:
            pages.append(int(p) + 1)
    if not pages:
        matches = re.findall(r'[Pp]agina\s*(\d+)', final_answer)
        pages = [int(p) for p in matches]
    pages = sorted(set(pages))

    raw_chunks = [doc.page_content for doc in source_docs]
    highlight_phrases = extract_highlight_phrases(raw_chunks)

    return {
        "brand_key": brand_key,
        "answer":    final_answer or "Geen informatie gevonden.",
        "pages":     pages,
        "chunks":    highlight_phrases,
    }


@app.route("/ask-all", methods=["POST"])
def ask_all():
    try:
        data  = request.get_json(force=True)
        query = (data or {}).get("query", "").strip()

        if not query:
            return jsonify({"error": "Geen vraag ontvangen."}), 400

        print(f"\n[ASK-ALL] Query={query}")

        brand_results = {}
        with ThreadPoolExecutor(max_workers=len(BRANDS)) as executor:
            futures = {
                executor.submit(run_brand_agent, key, query): key
                for key in BRANDS
            }
            for future in as_completed(futures):
                result = future.result()
                brand_results[result["brand_key"]] = result

        brand_summaries = "\n\n".join(
            f"## {BRANDS[key]['name']}\n{brand_results[key]['answer']}"
            for key in BRANDS
            if key in brand_results
        )

        synthesis_prompt = f"""Je bent een expert hypotheekadviseur. Hieronder staan de antwoorden van 4 Nederlandse hypotheekverstrekkers op de volgende vraag:

Vraag: {query}

{brand_summaries}

Herhaal de vraag als startpunt van het antwoord.
Geef een helder vergelijkend overzicht in tabelvorm:
- Zet de merken in de kolommen, zet de features in rijen 
- Vergelijk de merken op de gestelde vraag en markeer overeenkomsten en verschillen.
Na de tabel:
- Sluit af met een korte conclusie.
- Antwoord in dezelfde taal als de vraag."""

        synthesis_response = model.invoke([{"role": "user", "content": synthesis_prompt}])
        synthesis = synthesis_response.content

        brands_out = {
            key: {
                "answer": brand_results[key]["answer"],
                "pages":  brand_results[key]["pages"],
                "chunks": brand_results[key]["chunks"],   # ← included per brand
            }
            for key in BRANDS
            if key in brand_results
        }

        print(f"[DONE] ask-all synthesis ({len(synthesis)} chars)")
        return jsonify({
            "synthesis": synthesis,
            "brands":    brands_out,
        })

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": f"Fout: {str(e)}"}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5050)
