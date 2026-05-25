param(
    [switch]$Restart,
    [switch]$Test,
    [string]$TenantId = "0be7a2cd-43c7-42c4-a439-8307577255ac",
    [string]$ApiUrl   = "http://localhost:3001"
)

$ErrorActionPreference = "Stop"
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$PatchSrc    = Join-Path $ScriptDir "patch-all.sh"

if (-not (Test-Path $PatchSrc)) {
    Write-Error "patch-all.sh not found next to apply-patches.ps1."
    exit 1
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " IOS+ Apply Patches" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# Step 1: Convert CRLF -> LF before copying into the container.
# Windows saves text files with CRLF; sh requires LF-only.
Write-Host "[1/3] Stripping CR, copying patch-all.sh..." -ForegroundColor Gray
$raw      = [System.IO.File]::ReadAllText($PatchSrc)
$lfOnly   = $raw.Replace("`r`n", "`n").Replace("`r", "`n")
$tempFile = [System.IO.Path]::Combine($env:TEMP, "patch-all-lf.sh")
[System.IO.File]::WriteAllText($tempFile, $lfOnly, [System.Text.UTF8Encoding]::new($false))
docker cp $tempFile middleware-engine:/tmp/patch-all.sh
Remove-Item $tempFile -ErrorAction SilentlyContinue

# Step 2: Run the patch script inside the container.
Write-Host "[2/3] Running patch-all.sh inside middleware-engine..." -ForegroundColor Gray
docker exec --user root middleware-engine sh /tmp/patch-all.sh

# Step 3: Optionally restart, then optionally smoke-test.
if ($Restart) {
    Write-Host "[3/3] Restarting middleware-engine..." -ForegroundColor Gray
    docker restart middleware-engine
    Start-Sleep 7
    try {
        $h = (Invoke-RestMethod "$ApiUrl/health" -TimeoutSec 10).status
        Write-Host "      Health: $h" -ForegroundColor $(if ($h -eq "ok") { "Green" } else { "Red" })
    } catch {
        Write-Host "      Health check failed: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "[3/3] Skipping restart. Run 'docker restart middleware-engine' when ready." -ForegroundColor Yellow
}

if ($Test) {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host " Smoke Test" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan

    $body = @{
        input    = "What are the FISMA compliance requirements for IT federal contractors?"
        metadata = @{ source = "patch-smoke-test" }
    } | ConvertTo-Json

    try {
        $r = Invoke-RestMethod `
            -Uri         "$ApiUrl/v1/inference" `
            -Method      POST `
            -ContentType "application/json" `
            -Headers     @{ "x-tenant-id" = $TenantId; "x-session-id" = [guid]::NewGuid().ToString() } `
            -Body        $body

        $col = if ($r.policyAction -eq "APPROVE") { "Green" } else { "Red" }
        Write-Host "policyAction      : $($r.policyAction)"        -ForegroundColor $col
        Write-Host "ucoNodesEvaluated : $($r.ucoNodesEvaluated)"
        Write-Host "classificationLevel: $($r.classificationLevel)"
        Write-Host "totalLatencyMs    : $($r.totalLatencyMs)"
        if ($r.output) {
            $preview = $r.output.Substring(0, [Math]::Min(160, $r.output.Length))
            Write-Host "output (preview)  : $preview"
        } else {
            Write-Host "output            : (empty -- OpenAI quota exhausted)" -ForegroundColor Yellow
        }
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        Write-Host "INFERENCE FAILED: HTTP $code" -ForegroundColor Red
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
