const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" }));

// CORS (aceita lista separada por vírgula)
const allowed = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true); // Postman / server-to-server
      if (allowed.length === 0) return cb(null, true);
      return allowed.includes(origin) ? cb(null, true) : cb(new Error("CORS bloqueado: " + origin));
    },
    credentials: true
  })
);

const PORT = process.env.PORT || 5000;

// Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn("⚠️ Configure SUPABASE_URL e SUPABASE_SERVICE_KEY no Render > Environment.");
}

const supabase = createClient(SUPABASE_URL || "", SUPABASE_SERVICE_KEY || "");

// Healthcheck (Render)
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "rh-ciapi-backend", time: new Date().toISOString() });
});

// Teste simples (opcional): lista servidores
app.get("/api/servidores", async (req, res) => {
  try {
    const { data, error } = await supabase.from("servidores").select("*").limit(200);
    if (error) return res.status(400).json({ ok: false, error: error.message });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Backend rodando na porta ${PORT}`);
});
