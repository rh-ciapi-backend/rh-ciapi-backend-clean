const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const app = express();
app.disable("x-powered-by");

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

const exportDir =
  process.env.EXPORT_DIR || path.join("/tmp", "exports");

try {
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }
  app.locals.exportDir = exportDir;
} catch (err) {
  console.warn("Não foi possível preparar EXPORT_DIR:", String(err));
}

function safeRequire(modulePath, label) {
  try {
    const loaded = require(modulePath);
    console.log(`[BOOT] ${label} carregado: ${modulePath}`);
    return loaded;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[BOOT] ${label} não carregado: ${modulePath}`);
    console.warn(`[BOOT] Motivo: ${message}`);
    return null;
  }
}

const feriasExportRoutes = safeRequire(
  "./src/routes/feriasExportRoutes",
  "feriasExportRoutes"
);

const frequenciaRoutes = safeRequire(
  "./src/routes/frequenciaRoutes",
  "frequenciaRoutes"
);

const frequenciaExportRoutes = safeRequire(
  "./src/routes/frequenciaExportRoutes",
  "frequenciaExportRoutes"
);

app.get("/", (_req, res) => {
  return res.status(200).send("RH CIAPI Backend OK");
});

app.get("/health", (_req, res) => {
  return res.status(200).json({
    ok: true,
    service: "rh-ciapi-backend",
    time: new Date().toISOString(),
    exportDir,
    routes: {
      feriasExport: Boolean(feriasExportRoutes),
      frequencia: Boolean(frequenciaRoutes),
      frequenciaExport: Boolean(frequenciaExportRoutes),
    },
  });
});

app.get("/api/servidores", async (_req, res) => {
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

if (feriasExportRoutes) {
  app.use("/api/ferias", feriasExportRoutes);
} else {
  console.warn("[BOOT] Rotas de férias não registradas.");
}

if (frequenciaRoutes) {
  app.use("/api/frequencia", frequenciaRoutes);
} else {
  console.warn("[BOOT] Rotas principais de frequência não registradas.");
}

if (frequenciaExportRoutes) {
  app.use("/api/frequencia", frequenciaExportRoutes);
} else {
  console.warn("[BOOT] Rotas de exportação da frequência não registradas.");
}

app.use((req, res) => {
  return res.status(404).json({
    ok: false,
    error: `Rota não encontrada: ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, _req, res, next) => {
  console.error("Erro no backend:", err);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({
    ok: false,
    error:
      err instanceof Error
        ? err.message
        : "Erro interno inesperado no servidor.",
  });
});

app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
  console.log("Health: GET /health");
  console.log("Servidores: GET /api/servidores");
  console.log("Frequência: GET /api/frequencia");
  console.log("Exportação de frequência: POST /api/frequencia/exportar");
  console.log("Exportação de férias: POST /api/ferias/exportar");
});
