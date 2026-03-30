# 🏗️ Architecture

## System Overview

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Express    │────▶│   Groq API   │
│  React + TS  │◀────│   Backend    │◀────│  (LLM)       │
└─────────────┘     └──────┬───────┘     └──────────────┘
                           │
                    ┌──────┴───────┐
                    │ Vector Store │
                    │ (In-Memory)  │
                    └──────────────┘
```

## Frontend Architecture

```
src/
├── components/
│   ├── Chat/
│   │   ├── ChatContainer.tsx   # Main chat area
│   │   ├── ChatMessage.tsx     # Message bubble
│   │   └── ChatInput.tsx       # Input field
│   ├── Upload/
│   │   └── FileUpload.tsx      # Drag-and-drop upload
│   ├── Filter/
│   │   └── CategoryFilter.tsx  # Category chip selector
│   ├── Documents/
│   │   └── DocumentList.tsx    # Document list with actions
│   └── Layout/
│       ├── Header.tsx          # App header
│       └── Sidebar.tsx         # Sidebar container
├── hooks/
│   ├── useChat.ts              # Chat state management
│   └── useDocuments.ts         # Document CRUD
├── services/
│   └── api.ts                  # Backend API client
├── types/
│   ├── documents.ts            # Document types
│   └── ai.ts                   # AI query/response types
├── App.tsx                     # Root component
├── App.css                     # Application styles
└── main.tsx                    # Entry point
```

## Backend Architecture

```
server/
├── index.ts                    # Express server entry
├── routes/
│   ├── documents.ts            # Document CRUD endpoints
│   └── ai.ts                   # AI query endpoint
└── services/
    ├── groqClient.ts           # Groq API communication
    ├── textExtractor.ts        # PDF/text extraction
    ├── classifier.ts           # Document classification
    ├── chunker.ts              # Text chunking (300-800 tokens)
    ├── vectorStore.ts          # In-memory vector store
    └── ragPipeline.ts          # RAG query orchestration
```

## RAG Pipeline

### Upload Flow
1. User uploads document (PDF/image/text)
2. `textExtractor` extracts raw text
3. `classifier` sends text to Groq for classification
4. `chunker` splits text into 300-800 token chunks
5. `groqClient.generateSimpleEmbedding()` creates embeddings
6. `vectorStore.storeChunks()` persists with metadata

### Query Flow
1. User sends question + optional category filter
2. `vectorStore.searchSimilar()` retrieves top-K chunks
3. `ragPipeline` builds system prompt + context + question
4. `groqClient.chatCompletion()` gets grounded answer
5. Response includes answer + source attribution

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/documents/upload` | Upload & process document |
| GET | `/api/documents` | List all documents |
| GET | `/api/documents/categories` | Get categories |
| GET | `/api/documents/:id/download` | Download original file |
| DELETE | `/api/documents/:id` | Delete document |
| POST | `/api/ai/query` | Ask a RAG question |
| GET | `/api/ai/health` | Health check |
