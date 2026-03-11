const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const feriasExportRoutes = require("./src/routes/feriasExportRoutes");
const frequenciaRoutes = require("./src/routes/frequenciaRoutes");
const frequenciaExportRoutes = require("./src/routes/frequenciaExportRoutes");

dotenv.config();

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (corsOrigins.length === 0) return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS bloqueado: ${origin}`));
    },
    credentials: true,
  })
);

const PORT = process.env.PORT || 5000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn("SUPABASE_URL ou SUPABASE_SERVICE_KEY não configurados.");
}

const supabase = createClient(SUPABASE_URL || "", SUPABASE_SERVICE_KEY || "");
app.locals.supabase = supabase;

const exportDir = process.env.EXPORT_DIR || path.join("/tmp", "exports");
try {
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }
  app.locals.exportDir = exportDir;
} catch (err) {
  console.warn("Não foi possível preparar EXPORT_DIR:", String(err));
}

app.get("/", (req, res) => {
  res.status(200).send("RH CIAPI Backend OK");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "rh-ciapi-backend",
    time: new Date().toISOString(),
  });
});

app.get("/api/servidores", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("servidores")
      .select("*")
      .limit(1000);

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message,
      });
    }

    return res.status(200).json({
      ok: true,
      data: Array.isArray(data) ? data : [],
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/*
|--------------------------------------------------------------------------
| Rotas de Férias
|--------------------------------------------------------------------------
*/
app.use("/api/ferias", feriasExportRoutes);

/*
|--------------------------------------------------------------------------
| Rotas de Frequência
|--------------------------------------------------------------------------
| GET    /api/frequencia
| GET    /api/frequencia/:id
| POST   /api/frequencia
| PUT    /api/frequencia/:id
| DELETE /api/frequencia/:id
*/
app.use("/api/frequencia", frequenciaRoutes);

/*
|--------------------------------------------------------------------------
| Exportação de Frequência
|--------------------------------------------------------------------------
| POST /api/frequencia/exportar/docx
| POST /api/frequencia/exportar/pdf
| POST /api/frequencia/exportar/csv
*/
app.use("/api/frequencia", frequenciaExportRoutes);

app.use((req, res) => {
  return res.status(404).json({
    ok: false,
    error: `Rota não encontrada: ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, req, res, next) => {
  console.error("Erro no backend:", err);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({
    ok: false,
    error: err instanceof Error ? err.message : "Erro interno inesperado no servidor.",
  });
});

app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
  console.log(`Health: /health`);
  console.log(`Servidores: GET /api/servidores`);
  console.log(`Frequência: GET /api/frequencia`);
  console.log(`Exportação de frequência: POST /api/frequencia/exportar/:formato`);
  console.log(`Exportação de férias: POST /api/ferias/exportar`);
});
