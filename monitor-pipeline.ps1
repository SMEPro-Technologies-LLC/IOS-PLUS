# =============================================================================
# monitor-pipeline.ps1 — IOS+ Pipeline Health Monitor
# =============================================================================
# Usage:
#   .\monitor-pipeline.ps1                       # run once
#   .\monitor-pipeline.ps1 -Register             # daily 9 AM Task Scheduler job
#   .\monitor-pipeline.ps1 -Register -At "07:30" # custom time
#   .\monitor-pipeline.ps1 -Unregister           # remove scheduled task
# =============================================================================
param(
    [switch]$Register,
    [switch]$Unregister,
    [string]$At          = "09:00",
    [string]$ApiUrl      = "http://localhost:3001",
    [string]$LogPath     = "$PSScriptRoot\pipeline-monitor.log",
    [string]$ComposeDir  = $PSScriptRoot
)

$TaskName = "IOS-PLUS-Pipeline-Monitor"

if ($Unregister) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Scheduled task '$TaskName' removed." -ForegroundColor Yellow
    exit 0
}

if ($Register) {
    $action   = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-NonInteractive -WindowStyle Hidden -File `"$PSCommandPath`"" `
        -WorkingDirectory $ComposeDir
    $trigger  = New-ScheduledTaskTrigger -Daily -At $At
    $settings = New-ScheduledTaskSettingsSet `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
        -StartWhenAvailable
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action -Trigger $trigger -Settings $settings `
        -Description "IOS+ Pipeline Health Monitor" `
        -Force | Out-Null
    Write-Host "Task '$TaskName' registered — runs daily at $At." -ForegroundColor Green
    Write-Host "Log: $LogPath"
    exit 0
}

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss CDT"
$results   = [System.Collections.Generic.List[string]]::new()
$hasIssue  = $false

function Add-Result {
    param([string]$Line, [bool]$Issue = $false)
    $results.Add($Line)
    if ($Issue) { $script:hasIssue = $true }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " IOS+ Pipeline Health — $timestamp" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# 1. Health endpoint
try {
    $h    = Invoke-RestMethod "$ApiUrl/health" -TimeoutSec 8
    $line = "[OK]   Health endpoint: $($h.status)"
    Add-Result $line; Write-Host $line -ForegroundColor Green
} catch {
    $line = "[FAIL] Health endpoint unreachable: $($_.Exception.Message)"
    Add-Result $line -Issue $true; Write-Host $line -ForegroundColor Red
}

# 2. PIPELINE_ERROR scan (last 500 lines)
try {
    $raw    = & docker compose --project-directory $ComposeDir logs middleware-engine --tail=500 2>&1
    $errors = $raw | Select-String "PIPELINE_ERROR"
    if ($errors -and $errors.Count -gt 0) {
        $line = "[WARN] $($errors.Count) PIPELINE_ERROR(s) in last 500 log lines:"
        Add-Result $line -Issue $true; Write-Host $line -ForegroundColor Red
        $errors | Select-Object -Last 5 | ForEach-Object {
            Add-Result "       $_"; Write-Host "       $_" -ForegroundColor DarkRed
        }
    } else {
        $line = "[OK]   No PIPELINE_ERROR in last 500 log lines"
        Add-Result $line; Write-Host $line -ForegroundColor Green
    }
} catch {
    $line = "[WARN] Could not read docker logs: $($_.Exception.Message)"
    Add-Result $line -Issue $true; Write-Host $line -ForegroundColor Yellow
}

# 3. evidence_packages — last 24 h
try {
    $q    = "SELECT COUNT(*) FROM evidence_packages WHERE published_at > NOW() - INTERVAL '24 hours';"
    $cnt  = & docker exec cos-plus psql -U cos_admin ios_plus -t -c $q 2>&1
    $line = "[OK]   Evidence packages (24h): $($cnt.Trim())"
    Add-Result $line; Write-Host $line -ForegroundColor Green
} catch {
    $line = "[WARN] Could not query evidence_packages: $($_.Exception.Message)"
    Add-Result $line -Issue $true; Write-Host $line -ForegroundColor Yellow
}

# 4. gate_decisions — last 24 h
try {
    $q2  = "SELECT COUNT(*) FROM gate_decisions WHERE decided_at > NOW() - INTERVAL '24 hours';"
    $gc  = & docker exec cos-plus psql -U cos_admin ios_plus -t -c $q2 2>&1
    $line = "[OK]   Gate decisions (24h): $($gc.Trim())"
    Add-Result $line; Write-Host $line -ForegroundColor Green
} catch {
    $line = "[WARN] Could not query gate_decisions: $($_.Exception.Message)"
    Add-Result $line -Issue $true; Write-Host $line -ForegroundColor Yellow
}

# 5. Container status
foreach ($c in @("middleware-engine","cos-plus","gate-530","vault-dev","redis")) {
    $state = & docker inspect --format "{{.State.Status}}" $c 2>&1
    if ($state -eq "running") {
        $line = "[OK]   Container $c`: $state"
        Add-Result $line; Write-Host $line -ForegroundColor Green
    } else {
        $line = "[FAIL] Container $c`: $state"
        Add-Result $line -Issue $true; Write-Host $line -ForegroundColor Red
    }
}

$summary = if ($hasIssue) { "ISSUES FOUND" } else { "ALL OK" }
$entry   = "[$timestamp] $summary`n" + ($results -join "`n") + "`n"
Add-Content -Path $LogPath -Value $entry

Write-Host ""
Write-Host "Result: $summary" -ForegroundColor $(if ($hasIssue) { "Red" } else { "Green" })
Write-Host "Log appended to: $LogPath"
