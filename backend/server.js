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

function normalizeAllowedOrigins() {
  const configured = String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const defaults = [
    "https://www.rhciapi.com.br",
    "https://rhciapi.com.br",
    "https://api.rhciapi.com.br",
  ];

  return Array.from(new Set([...defaults, ...configured]));
}

const allowedOrigins = normalizeAllowedOrigins();

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();

    if (hostname === "localhost" || hostname === "127.0.0.1") return true;

    if (
      hostname.endsWith(".vercel.app") &&
      (hostname.includes("rh-ciapi") || hostname.includes("rhciapi"))
    ) {
      return true;
    }

    return false;
  } catch (_) {
    return false;
  }
}

app.use(
  cors({
    origin(origin, cb) {
      if (isAllowedOrigin(origin)) return cb(null, true);
      return cb(new Error(`CORS bloqueado: ${origin}`));
    },
    credentials: true,
  })
);

app.options("*", cors());

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

const eventosRoutes = safeRequire(
  "./src/routes/eventosRoutes",
  "eventosRoutes"
);

const adminRoutes = safeRequire(
  "./src/routes/adminRoutes",
  "adminRoutes"
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
    cors: {
      allowedOrigins,
    },
    routes: {
      feriasExport: Boolean(feriasExportRoutes),
      frequencia: Boolean(frequenciaRoutes),
      frequenciaExport: Boolean(frequenciaExportRoutes),
      eventos: Boolean(eventosRoutes),
      administracao: Boolean(adminRoutes),
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

if (eventosRoutes) {
  app.use("/api/eventos", eventosRoutes);
} else {
  console.warn("[BOOT] Rotas de eventos não registradas.");
}

if (adminRoutes) {
  app.use("/api/admin", adminRoutes);
} else {
  console.warn("[BOOT] Rotas de administração não registradas.");
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
  console.log("Eventos: GET /api/eventos");
  console.log("Tipos de evento: GET /api/eventos/tipos");
  console.log("Administração: GET /api/admin/users");
  console.log("Logs de auditoria: GET /api/admin/logs");
});
