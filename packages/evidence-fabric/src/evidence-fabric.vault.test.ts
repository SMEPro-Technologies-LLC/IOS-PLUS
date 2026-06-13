import { describe, expect, it, vi } from "vitest";
import { EvidenceFabricService } from "./index.js";
import type { KeyProvider } from "./keyProvider.js";

describe("Evidence Fabric signing custody", () => {
  it("uses Vault transit signing when Vault config is present", async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    const registry = {
      pool: vi.fn().mockReturnValue({ query: queryMock })
    } as any;
    const keyProvider: KeyProvider = {
      getSigningKey: vi.fn().mockResolvedValue(new Uint8Array(32).fill(7))
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { signature: "vault:v1:YWJjKysvPQ==" } })
    });
    vi.stubGlobal("fetch", fetchMock as any);

    const service = new EvidenceFabricService({
      vault: {
        vaultAddr: "http://vault:8200",
        keyPath: "transit/keys/ios-evidence-signing",
        token: "vault-token"
      },
      publicKeyFilesystemPath: "/tmp/current.pub",
      dnsTxtZone: "_ios-signing-key.smeprotech.com",
      activeKeyId: "key-1"
    }, registry, keyProvider);

    await service.createAndCommit({
      tenantId: "tenant-1",
      sessionId: "session-1",
      eventType: "gate_530_decision",
      layerDepth: 5,
      classificationLevel: "CONFIDENTIAL",
      previousHashChain: [],
      payloadHash: "hash-1",
      attestation: { source: "test" }
    } as any);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((keyProvider.getSigningKey as any)).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1);
    const insertedSignature = queryMock.mock.calls[0][1][6];
    expect(insertedSignature).toBe("YWJjKysvPQ");
  });

  it("falls back to local key provider when Vault token is absent", async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    const registry = {
      pool: vi.fn().mockReturnValue({ query: queryMock })
    } as any;
    const keyProvider: KeyProvider = {
      getSigningKey: vi.fn().mockResolvedValue(new Uint8Array(32).fill(9))
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as any);

    const service = new EvidenceFabricService({
      vault: {
        vaultAddr: "http://vault:8200",
        keyPath: "transit/keys/ios-evidence-signing",
        token: ""
      },
      publicKeyFilesystemPath: "/tmp/current.pub",
      dnsTxtZone: "_ios-signing-key.smeprotech.com",
      activeKeyId: "key-1"
    }, registry, keyProvider);

    await service.createAndCommit({
      tenantId: "tenant-1",
      sessionId: "session-1",
      eventType: "gate_530_decision",
      layerDepth: 5,
      classificationLevel: "CONFIDENTIAL",
      previousHashChain: [],
      payloadHash: "hash-1",
      attestation: { source: "test" }
    } as any);

    expect((keyProvider.getSigningKey as any)).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
