/**
 * HomeBrain — Backend Server
 *
 * Express server providing REST API for:
 * - Document upload & management
 * - RAG-based AI queries
 */
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import documentRoutes from "./routes/documents.js";
import aiRoutes from "./routes/ai.js";
import manualRoutes from "./routes/manuals.js";

dotenv.config();


const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use("/api/documents", documentRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/manuals", manualRoutes);

// ── Login endpoint (hardcoded credentials) ─────────────────────
const VALID_USER = { username: "שמעוני", password: "שמעוני" };

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (username === VALID_USER.username && password === VALID_USER.password) {
    res.json({ success: true, user: { username } });
  } else {
    res.status(401).json({ success: false, error: "שם משתמש או סיסמה שגויים" });
  }
});

// Simple health check (for Render / uptime monitors)
app.get("/healthz", (_req, res) => {
  res.status(200).send("OK");
});

// Detailed health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    name: "HomeBrain API",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction // eslint-disable-line @typescript-eslint/no-unused-vars
  ) => {
    console.error("Server error:", err);
    res.status(500).json({
      error: "שגיאת שרת פנימית",
      details: err.message,
    });
  }
);

app.listen(PORT, () => {
  console.log(`
🧠 HomeBrain Server is running!
📡 API: http://localhost:${PORT}/api
📄 Documents: http://localhost:${PORT}/api/documents
🤖 AI: http://localhost:${PORT}/api/ai
❤️  Health: http://localhost:${PORT}/api/health
  `);
});

export default app;
