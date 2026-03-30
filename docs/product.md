# 🧠 HomeBrain — Product Overview

## What is HomeBrain?

HomeBrain is a **RAG-based home document assistant** that helps families manage and query their household device documents (manuals, warranties, installation guides).

## Key Features

- **Document Upload** — Upload PDFs, images, or text files of device manuals and warranties
- **Automatic Classification** — AI classifies documents by device type, document category, and language
- **Hebrew Q&A** — Ask questions in Hebrew and get grounded answers based only on uploaded documents
- **Category Filtering** — Filter queries by device type for more precise answers
- **Source Attribution** — Every answer includes references to the original documents
- **File Retrieval** — Download original uploaded files (e.g., warranty certificates)

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Node.js + Express
- **AI Provider**: Groq API (LLaMA 3.1 models)
- **RAG Pipeline**: Custom implementation with in-memory vector store

## Language Rule

ALL responses from the AI are in **Hebrew** (עברית), even if the user writes in English.
