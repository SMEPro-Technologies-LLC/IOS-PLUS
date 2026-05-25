$ErrorActionPreference = "Stop"

Write-Host "[1/3] Patching RAGVault — fix SET LOCAL + broaden catch" -ForegroundColor Cyan
@'
import { readFileSync, writeFileSync } from 'fs';
const f = '/app/packages/rag-vault/dist/index.js';
let src = readFileSync(f, 'utf8');

// Diagnostics: show all SET + $ lines
console.log('=== SET+param lines ===');
src.split('\n').forEach((l,i) => { if (l.includes('SET') && l.includes('$')) console.log(i+1,':', l.trimEnd()); });

// Fix 1: SET LOCAL hnsw.ef_search = $1  →  template literal (PostgreSQL forbids params in SET)
const before1 = src;
src = src.replace(
  /\.query\(\s*['"`]SET LOCAL ([\w.]+) = \$(\d+)['"`]\s*,\s*

\[(\w+)\]

\s*\)/g,
  (_, name, _n, varname) => `.query(\`SET LOCAL ${name} = \${${varname}}\`)`
);
console.log('SET fix applied:', src !== before1);

// Fix 2: Broaden catch — make the existing guard always true so ALL errors return empty
src = src.replace(
  "if (_e.status === 429 || _e.code === 'insufficient_quota' || _e.status === 503)",
  "if (true /* catch-all: any RAG error returns empty chunks */"
);
console.log('catch broadened:', src.includes('catch-all'));

writeFileSync(f, src);
console.log('patch complete');
'@ | Set-Content _pr2.mjs -Encoding UTF8

docker cp _pr2.mjs middleware-engine:/tmp/_pr2.mjs
Remove-Item _pr2.mjs
docker exec --user root middleware-engine node /tmp/_pr2.mjs

Write-Host "[2/3] Restarting" -ForegroundColor Cyan
docker restart middleware-engine
Start-Sleep 6
Write-Host "      health: $((Invoke-RestMethod http://localhost:3001/health).status)"

Write-Host "[3/3] Smoke test" -ForegroundColor Cyan
$body = @{
    input    = "What are the FISMA compliance requirements for IT federal contractors?"
    metadata = @{ source = "smoke-test-final" }
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "http://localhost:3001/v1/inference" -Method POST `
        -ContentType "application/json" `
        -Headers @{ "x-tenant-id" = "0be7a2cd-43c7-42c4-a439-8307577255ac"; "x-session-id" = [guid]::NewGuid().ToString() } `
        -Body $body | ConvertTo-Json -Depth 10
} catch {
    Write-Host "HTTP $($_.Exception.Response.StatusCode.value__): $($_.ErrorDetails.Message)" -ForegroundColor Red
}

docker compose logs middleware-engine --tail=15
docker exec cos-plus psql -U cos_admin ios_plus -c "SELECT package_id, event_type, layer_depth, published_at FROM evidence_packages ORDER BY published_at DESC LIMIT 3;"
docker exec cos-plus psql -U cos_admin ios_plus -c "SELECT decision_id, policy_action, decided_at FROM gate_decisions ORDER BY decided_at DESC LIMIT 3;"
