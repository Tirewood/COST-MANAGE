import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const DATA_PATH = path.join(__dirname, "data.json");

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.get("/api/records", async (req, res) => {
    try {
      const data = await fs.readFile(DATA_PATH, "utf-8");
      res.json(JSON.parse(data));
    } catch (err) {
      res.json([]);
    }
  });

  app.post("/api/records", async (req, res) => {
    try {
      await fs.writeFile(DATA_PATH, JSON.stringify(req.body, null, 2), "utf-8");
      res.json({ status: "ok" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to save data" });
    }
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
