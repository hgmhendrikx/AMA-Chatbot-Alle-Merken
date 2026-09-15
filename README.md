# AMA-Chatbot-Alle-Merken

A Flask-based chatbot with RAG infrastructure that answers questions about the mortgage acceptance
policies of four Achmea Bank mortgage brands. It can answer for a single brand, or
compare answers across all four brands at once.

## What it does

- The app retrieves relevant passages from that brand's policy PDF and answers with
  citations to the exact page numbers used.
- Users can also ask one question across all brands at once. Each brand answers
  independently, and the results are synthesized into a comparison.

## Tech Stack

| Layer | Technology |
|---|---|
| Web framework | Flask + Gunicorn |
| LLM | OpenAI `gpt-4.1` (via LangChain) |
| Embeddings | OpenAI `text-embedding-3-large` |
| Vector store | Pinecone (serverless) |
| Agent framework | LangGraph (`create_react_agent`, ReAct pattern) |
| PDF ingestion | `PyPDFLoader` + `RecursiveCharacterTextSplitter` |

https://www.langchain.com/

https://flask.palletsprojects.com/en/stable/

https://www.pinecone.io/

## Project Structure

app.py - Flask app, agent orchestration, API routes

ingest.py - One-off script to embed brand PDFs into Pinecone

brands.py - Brand config: names, colors, PDF paths

requirements.txt - Python dependencies

Dockerfile - Container build (gunicorn entrypoint)

templates/ - HTML template(s) for the chat UI

static/ - JS, CSS, brand PDFs

## Requirements
- Python 3.11
- An OpenAI API key
- A Pinecone API key + project
The app requires two API keys: (OPENAI_API_KEY, PINECONE_API_KEY=). These are currently managed by Guido Hendrix and are stored by him. 

## Deployment

**Current:** This app runs on [Render](https://render.com) (add link)

Current access to the Render dashboard and API keys is held by Guido Hendrix. 

**Planned:** 

xxxx




    
