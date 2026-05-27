/**
 * IOS+ Middleware Engine — entry point
 * YBR-L4 Tier 2: Orchestration layer
 * 3 replicas, 16Gi RAM per EB Doc 6 §2.1
 */
import { createRestApp } from "./transport/rest.js";
import { pino } from "pino";
import { CosConnectionRegistry, GateDecisionRepository } from "@ios-plus/cos-plus";
import { UCOResolver } from "@ios-plus/uco-resolver";
import { EvidenceFabricService, LocalEnvKeyProvider, LocalFileKeyProvider } from "@ios-plus/evidence-fabric";
import { RAGVaultService } from "@ios-plus/rag-vault";
import type { NAICSProfile } from "@ios-plus/shared";
import type { PipelineDependencies } from "./orchestrator/pipeline.js";
import fs from "node:fs";

const log = pino({ level: process.env["LOG_LEVEL"] ?? "info" });

function loadVaultSecrets() {
  const vaultSecretsPath = "/vault/secrets/ios-plus.env";
  if (fs.existsSync(vaultSecretsPath)) {
    try {
      const content = fs.readFileSync(vaultSecretsPath, "utf8");
      log.info({ path: vaultSecretsPath }, "Loading secrets from Vault Agent sidecar projection file");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
          const eqIndex = trimmed.indexOf("=");
          const key = trimmed.slice(0, eqIndex).trim();
          const val = trimmed.slice(eqIndex + 1).trim();
          const cleanedVal = val.replace(/^['"]|['"]$/g, "");
          if (key) {
            process.env[key] = cleanedVal;
          }
        }
      }
    } catch (err) {
      log.error({ err, path: vaultSecretsPath }, "Error loading secrets from Vault projection file");
    }
  }
}

function validateSecrets() {
  const requiredSecrets = [
    "COS_HOST",
    "COS_DATABASE",
    "COS_PASSWORD_IOS_APP",
    "COS_PASSWORD_RAG_READER",
    "COS_PASSWORD_AUDIT_WRITER",
    "COS_PASSWORD_AUDIT_READER",
    "COS_PASSWORD_RAG_WRITER",
    "COS_PASSWORD_COS_ADMIN",
    "REDIS_URL",
    "VAULT_ADDR",
    "VAULT_TRANSIT_KEY_PATH",
    "OPENAI_API_KEY",
  ];
  
  const missing: string[] = [];
  for (const key of requiredSecrets) {
    if (!process.env[key] || process.env[key]?.trim() === "") {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    if (process.env["NODE_ENV"] === "production") {
      log.fatal({ missing }, "CRITICAL STARTUP ERROR: Missing required secrets. Terminating.");
      process.exit(1);
    } else {
      log.warn({ missing }, "WARNING: Missing required secrets in development mode.");
    }
  } else {
    log.info("Secrets validation passed successfully.");
  }
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

async function main() {
  loadVaultSecrets();
  validateSecrets();
  log.info("IOS+ Middleware Engine starting");
  const port = parseInt(process.env["PORT"] ?? "3000");

  // COS+ per-role connection pool registry
  const cosRegistry = new CosConnectionRegistry({
    host:     requireEnv("COS_HOST"),
    port:     parseInt(process.env["COS_PORT"] ?? "5432"),
    database: requireEnv("COS_DATABASE"),
    ssl:      process.env["COS_SSL"] === "true",
    poolSize: parseInt(process.env["COS_POOL_SIZE"] ?? "15"),
    passwords: {
      ios_app:      requireEnv("COS_PASSWORD_IOS_APP"),
      audit_writer: requireEnv("COS_PASSWORD_AUDIT_WRITER"),
      audit_reader: requireEnv("COS_PASSWORD_AUDIT_READER"),
      rag_reader:   requireEnv("COS_PASSWORD_RAG_READER"),
      rag_writer:   requireEnv("COS_PASSWORD_RAG_WRITER"),
      cos_admin:    requireEnv("COS_PASSWORD_COS_ADMIN"),
    },
  });


  // UCO Resolver (L3 — Ontological Mapping)
  const ucoResolver = new UCOResolver({
    databaseUrl: process.env["COS_URL_RAG_READER"] ??
      `postgresql://rag_reader:${requireEnv("COS_PASSWORD_RAG_READER")}@${requireEnv("COS_HOST")}:${process.env["COS_PORT"] ?? "5432"}/${requireEnv("COS_DATABASE")}`,
  });


  // Initialize Key Custody Provider
  let keyProvider;
  if (process.env["SIGNING_KEY_FILE_PATH"]) {
    keyProvider = new LocalFileKeyProvider(process.env["SIGNING_KEY_FILE_PATH"]);
    log.info({ path: process.env["SIGNING_KEY_FILE_PATH"] }, "Initialized LocalFileKeyProvider (On-Premises custody)");
  } else {
    keyProvider = new LocalEnvKeyProvider(requireEnv("SIGNING_KEY_PRIVATE_BASE64"));
    log.info("Initialized LocalEnvKeyProvider (SaaS / Default custody)");
  }

  let vaultToken = process.env["VAULT_TOKEN"];
  if (!vaultToken && fs.existsSync("/vault/secrets/token")) {
    try {
      vaultToken = fs.readFileSync("/vault/secrets/token", "utf8").trim();
      log.info("Loaded Vault token from Vault Agent projection /vault/secrets/token");
    } catch (err) {
      log.error({ err }, "Failed to read Vault token from /vault/secrets/token");
    }
  }

  // Evidence Fabric (L4 — Evidence Anchoring)
  const evidenceFabric = new EvidenceFabricService({
    vault: {
      vaultAddr: requireEnv("VAULT_ADDR"),
      keyPath:   requireEnv("VAULT_TRANSIT_KEY_PATH"),
      token:     vaultToken ?? "",
    },
    publicKeyFilesystemPath: process.env["SIGNING_KEY_PUBKEY_PATH"] ?? "/run/secrets/signing-pubkey.pem",
    dnsTxtZone:  requireEnv("SIGNING_KEY_DNS_ZONE"),
    activeKeyId: requireEnv("SIGNING_KEY_ACTIVE_ID"),
  }, cosRegistry, keyProvider);


  // RAG Vault (L6 — Retrieval Augmented Generation)
  const ragVault = new RAGVaultService({
    openaiApiKey:        requireEnv("OPENAI_API_KEY"),
    embeddingModel:      process.env["RAG_EMBEDDING_MODEL"]       ?? "text-embedding-3-large",
    embeddingDimensions: parseInt(process.env["RAG_EMBEDDING_DIM"]          ?? "3072"),
    maxChunksPerQuery:   parseInt(process.env["RAG_MAX_CHUNKS"]              ?? "8"),
    similarityThreshold: parseFloat(process.env["RAG_SIMILARITY_THRESHOLD"] ?? "0.75"),
    redisUrl:            requireEnv("REDIS_URL"),
  }, cosRegistry);

  // NAICS profile for this tenant deployment (drives UCO node selection at L3)
  const tenantId = requireEnv("TENANT_ID");
  const iosAppPool = cosRegistry.pool('ios_app');

  let riskTolerance = 7; // default fallback
  try {
    const tenantRes = await iosAppPool.query(
      'SELECT risk_tolerance FROM tenant_registry WHERE tenant_id = $1',
      [tenantId]
    );
    if (tenantRes.rows[0]) {
      riskTolerance = tenantRes.rows[0].risk_tolerance;
      log.info({ tenantId, riskTolerance }, "Resolved tenant risk tolerance from database");
    }
  } catch (err) {
    log.error({ err }, "Failed to query tenant risk tolerance, using default");
  }

  let jurisdictions: string[] = ["Federal"];
  try {
    const profileRes = await iosAppPool.query(
      'SELECT jurisdictions FROM regulatory_profiles WHERE tenant_id = $1 ORDER BY effective_date DESC LIMIT 1',
      [tenantId]
    );
    if (profileRes.rows[0]?.jurisdictions) {
      jurisdictions = profileRes.rows[0].jurisdictions;
      log.info({ tenantId, jurisdictions }, "Resolved tenant jurisdictions from regulatory_profiles");
    } else {
      const tnpRes = await iosAppPool.query(
        'SELECT jurisdictions FROM tenant_naics_profiles WHERE tenant_id = $1 ORDER BY effective_date DESC LIMIT 1',
        [tenantId]
      );
      if (tnpRes.rows[0]?.jurisdictions) {
        jurisdictions = tnpRes.rows[0].jurisdictions;
        log.info({ tenantId, jurisdictions }, "Resolved tenant jurisdictions from tenant_naics_profiles");
      }
    }
  } catch (err) {
    log.error({ err }, "Failed to query tenant jurisdictions, using default");
  }

  const naicsProfile: NAICSProfile = {
    tenantId,
    naicsCodes:         process.env["TENANT_NAICS_CODES"] ? process.env["TENANT_NAICS_CODES"].split(",").map(s => s.trim()) : [],
    additionalSicCodes: process.env["TENANT_SIC_CODES"]   ? process.env["TENANT_SIC_CODES"].split(",").map(s => s.trim())   : [],
    cipCodes:           process.env["TENANT_CIP_CODES"]   ? process.env["TENANT_CIP_CODES"].split(",").map(s => s.trim())   : [],
    socCodes:           process.env["TENANT_SOC_CODES"]   ? process.env["TENANT_SOC_CODES"].split(",").map(s => s.trim())   : [],
    isicCodes:          process.env["TENANT_ISIC_CODES"]  ? process.env["TENANT_ISIC_CODES"].split(",").map(s => s.trim())  : [],
    hsHtsCodes:         process.env["TENANT_HS_HTS_CODES"] ? process.env["TENANT_HS_HTS_CODES"].split(",").map(s => s.trim()) : [],
    effectiveDate:      process.env["TENANT_NAICS_EFFECTIVE_DATE"] ?? new Date().toISOString().slice(0, 10),
    jurisdictions:      jurisdictions as any,
    riskTolerance,
  };

  const gateDecisionRepository = new GateDecisionRepository(cosRegistry);

  const deps: PipelineDependencies = {
    ucoResolver,
    evidenceFabric,
    ragVault,
    gateDecisionRepository,
    cosRegistry,
  };

  const app = await createRestApp(deps, naicsProfile);

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, "0.0.0.0", () => {
      log.info({ port }, "REST transport listening");
      resolve();
    });
    server.on("error", reject);

    // Graceful shutdown
    const shutdown = (sig: string) => {
      log.info({ signal: sig }, "Shutdown signal received");
      server.close(() => process.exit(0));
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT",  () => shutdown("SIGINT"));
  });
}

main().catch(err => { console.error(err); process.exit(1); });
