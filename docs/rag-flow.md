# 🔄 RAG Flow

## Upload Flow (Document Ingestion)

```
User uploads file
       │
       ▼
┌─────────────────┐
│  Extract Text   │  (pdf-parse / OCR for images)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Classify Doc    │  → category, documentType, language, confidence
│ (via Groq LLM)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Chunk Text     │  → 300-800 token chunks with overlap
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Generate        │  → Deterministic embedding (128-dim)
│ Embeddings      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Store in        │  → Chunks + embeddings + metadata
│ Vector Store    │
└─────────────────┘
```

## Query Flow (RAG Retrieval)

```
User asks question
       │
       ▼
┌─────────────────┐
│ Apply category  │  (optional filter)
│ filter          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Embed query &   │  → Cosine similarity search
│ retrieve top-K  │  → K = 5 most similar chunks
│ chunks          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Build prompt    │  → System rules + context chunks + user question
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Send to Groq    │  → LLaMA 3.1 70B Versatile
│ LLM             │  → temperature: 0.1
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Return answer   │  → Grounded Hebrew response + source references
└─────────────────┘
```

## Chunking Strategy

- **Target size**: 300–800 tokens per chunk (~1200–3200 characters)
- **Overlap**: 200 characters between consecutive chunks
- **Split priorities**: Paragraphs → Sentences → Character limit
- **Metadata preserved**: fileName, category, documentType, position

## Embedding Strategy

Using a lightweight deterministic embedding based on character n-grams:
- Dimension: 128
- Method: Trigonometric hashing (sin/cos of character codes and bigrams)
- Normalized to unit vectors for cosine similarity

> **Note**: For production, replace with a dedicated embedding model
> (e.g., OpenAI `text-embedding-3-small` or HuggingFace models)

## Retrieval Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `topK` | 5 | Number of chunks retrieved per query |
| `temperature` | 0.1 | Low temperature for factual responses |
| `maxTokens` | 2048 | Maximum response length |
