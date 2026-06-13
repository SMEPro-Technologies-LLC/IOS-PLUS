import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv7 } from "uuid";

const { Client } = pg;

function loadDotenv() {
  const paths = [".env", "../.env", "../../.env", "../../../.env"];
  for (const p of paths) {
    const fullPath = path.resolve(p);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
          const parts = trimmed.split("=");
          const k = parts[0]?.trim();
          if (k) {
            const v = parts.slice(1).join("=").trim().replace(/^['"]|['"]$/g, "");
            if (!process.env[k]) {
              process.env[k] = v;
            }
          }
        }
      }
      break;
    }
  }
}

describe("COS+ WORM Trigger Database Integration Tests", () => {
  let dsn: string | undefined;
  let hasDb = false;

  beforeAll(async () => {
    loadDotenv();
    
    // We connect as cos_admin to insert key and cleanup, and test WORM enforcement
    const host = process.env["COS_DB_HOST"] || process.env["COS_HOST"] || "localhost";
    const port = process.env["COS_DB_PORT"] || process.env["COS_PORT"] || "5432";
    const db = process.env["COS_DB_NAME"] || process.env["COS_DATABASE"] || "ios_plus";
    const password = process.env["COS_DB_PASSWORD_COS_ADMIN"] || "iosplus_dev_admin";
    
    dsn = `postgresql://cos_admin:${password}@${host}:${port}/${db}`;
    
    // Check if DB is running
    const client = new Client({ connectionString: dsn });
    try {
      await client.connect();
      hasDb = true;
      await client.end();
    } catch (e) {
      console.warn("Live database not reachable, skipping WORM integration tests.");
    }
  });

  it("blocks UPDATE and DELETE operations on evidence_packages", async () => {
    if (!hasDb) {
      throw new Error(
        "WORM integration test requires a live database. " +
        "Ensure the Postgres service container is running and COS_DB_* environment variables are set. " +
        "A silent skip here would produce a false-green CI result for a headline compliance claim."
      );
    }

    const client = new Client({ connectionString: dsn });
    await client.connect();

    // 1. Resolve or insert an active key to reference
    let keyId: string;
    const keyRes = await client.query("SELECT key_id FROM ios_signing_keys LIMIT 1");
    if (keyRes.rows[0]) {
      keyId = keyRes.rows[0].key_id;
    } else {
      keyId = uuidv7();
      await client.query(
        `INSERT INTO ios_signing_keys (
           key_id,
           public_key_ed25519,
           dns_txt_record,
           filesystem_path,
           expires_at
         )
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '90 days')`,
        [keyId, "pubkey-dummy-data", "dns-record", "/tmp/dummy.pub"]
      );
    }

    // 2. Insert test evidence package
    const packageId = uuidv7();
    const tenantId = uuidv7();
    const sessionId = uuidv7();
    
    await client.query(
      `INSERT INTO evidence_packages 
       (package_id, tenant_id, session_id, event_type, layer_depth, canonical_payload, signature, verification_key_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        packageId,
        tenantId,
        sessionId,
        "INFERENCE_REQUEST",
        4,
        JSON.stringify({ test: "data" }),
        "dummy-signature",
        keyId
      ]
    );

    // 3. Attempt UPDATE - expect failure due to WORM trigger
    let updateFailed = false;
    try {
      await client.query(
        "UPDATE evidence_packages SET event_type = 'WORM_COMMIT' WHERE package_id = $1",
        [packageId]
      );
    } catch (err: any) {
      updateFailed = true;
      expect(err.message).toContain("WORM VIOLATION");
    }
    expect(updateFailed).toBe(true);

    // 4. Attempt DELETE - expect failure due to WORM trigger
    let deleteFailed = false;
    try {
      await client.query(
        "DELETE FROM evidence_packages WHERE package_id = $1",
        [packageId]
      );
    } catch (err: any) {
      deleteFailed = true;
      expect(err.message).toContain("WORM VIOLATION");
    }
    expect(deleteFailed).toBe(true);

    await client.end();
  });
});
