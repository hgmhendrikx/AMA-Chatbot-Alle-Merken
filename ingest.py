import os
from brands import BRANDS
from langchain_openai import OpenAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pinecone import Pinecone, ServerlessSpec

# ── Config ────────────────────────────────────────────────────
INDEX_NAME = "hypotheek-docs"

# ── Init Pinecone ─────────────────────────────────────────────
pc = Pinecone()
if INDEX_NAME not in [i.name for i in pc.list_indexes()]:
    pc.create_index(
        name=INDEX_NAME,
        dimension=3072,   # text-embedding-3-large
        metric="cosine",
        spec=ServerlessSpec(cloud="aws", region="us-east-1")
    )
    print(f"Created index: {INDEX_NAME}")

embeddings   = OpenAIEmbeddings(model="text-embedding-3-large")
vector_store = PineconeVectorStore(index_name=INDEX_NAME, embedding=embeddings)
splitter     = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200, add_start_index=True)

# ── Index each brand ──────────────────────────────────────────
for brand_key, brand in BRANDS.items():
    print(f"\nIndexing {brand['name']}...")
    loader = PyPDFLoader(brand["pdf_url"])
    docs   = loader.load()
    splits = splitter.split_documents(docs)

    # Tag every chunk with the brand
    for doc in splits:
        doc.metadata["brand"] = brand_key

    vector_store.add_documents(documents=splits)
    print(f"  ✓ {len(splits)} chunks indexed for {brand['name']}")

print("\nAll brands indexed successfully.")
