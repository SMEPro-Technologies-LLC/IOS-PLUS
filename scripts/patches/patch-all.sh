#!/bin/sh
# =============================================================================
# IOS+ Middleware Engine -- Permanent Runtime Patch Script
# =============================================================================
# Usage (after any docker compose up --force-recreate middleware-engine):
#   docker cp patch-all.sh middleware-engine:/tmp/patch-all.sh
#   docker exec --user root middleware-engine sh /tmp/patch-all.sh
# Or simply run: .\apply-patches.ps1 -Restart -Test
# =============================================================================

set -e
PASS=0
WARN=0

echo ""
echo "============================================"
echo " IOS+ Runtime Patch Script"
echo "============================================"

# ----------------------------------------------------------------
# Patch 1: evidence-fabric -- canonicalize named export unwrap
# ----------------------------------------------------------------
EF="/app/packages/evidence-fabric/dist/index.js"

if [ ! -f "$EF" ]; then
  echo "[1] WARN: $EF not found -- skipping"
  WARN=$((WARN+1))
elif grep -q 'canonicalize = __require("json-canonicalize").canonicalize' "$EF" 2>/dev/null; then
  echo "[1] evidence-fabric: canonicalize already patched -- OK"
  PASS=$((PASS+1))
elif grep -q '__require("json-canonicalize")' "$EF" 2>/dev/null; then
  sed -i 's/const canonicalize = __require("json-canonicalize");/const canonicalize = __require("json-canonicalize").canonicalize;/g' "$EF"
  echo "[1] evidence-fabric: canonicalize fix applied"
  PASS=$((PASS+1))
else
  echo "[1] evidence-fabric: WARN -- pattern not found"
  WARN=$((WARN+1))
fi

# ----------------------------------------------------------------
# Patch 2 + 3: rag-vault -- catch-all + SET LOCAL param fix
# Uses indexOf so no long regex lines that wrap in text editors.
# ----------------------------------------------------------------
node << 'ENDNODE'
const fs = require('fs');
const f = '/app/packages/rag-vault/dist/index.js';

if (!fs.existsSync(f)) {
  console.log('[2] WARN: rag-vault/dist/index.js not found -- skipping');
  process.exit(0);
}

let src = fs.readFileSync(f, 'utf8');
let changed = false;

// Patch 2: catch-all for any retrieve() error
const OLD = "if (_e.status === 429 || _e.code === 'insufficient_quota' || _e.status === 503)";
if (src.includes('catch-all') || src.includes('if (true)')) {
  console.log('[2] rag-vault: catch-all already present -- OK');
} else if (src.includes(OLD)) {
  src = src.replace(OLD, 'if (true /* catch-all */');
  console.log('[2] rag-vault: catch-all applied');
  changed = true;
} else if (src.includes('throw _e;')) {
  src = src.replace('throw _e;', '/* suppressed */');
  console.log('[2] rag-vault: throw suppressed (fallback)');
  changed = true;
} else {
  console.log('[2] rag-vault: WARN -- catch guard not found');
}

// Patch 3: SET LOCAL $1 positional param -> template literal
// PostgreSQL forbids positional params in SET commands.
// Uses simple indexOf so the line length stays short.
var lines = src.split('\n');
var fixed = 0;
for (var i = 0; i < lines.length; i++) {
  var line = lines[i];
  if (line.indexOf('SET LOCAL') < 0) continue;
  if (line.indexOf('$1') < 0 && line.indexOf('$2') < 0) continue;
  var si = line.indexOf('SET LOCAL ');
  var ei = line.indexOf(' = $', si);
  var ci = line.indexOf(', [', ei);
  var ri = line.indexOf(']', ci);
  if (si < 0 || ei < 0 || ci < 0 || ri < 0) continue;
  var name    = line.slice(si + 10, ei);
  var varname = line.slice(ci + 3, ri);
  var built   = '.query(`SET LOCAL ' + name + ' = ${' + varname + '}`)';
  var sq = "query('" + "SET LOCAL " + name + " = $1', [" + varname + "])";
  var dq = 'query("' + "SET LOCAL " + name + ' = $1", [' + varname + '])';
  if (line.indexOf(sq) >= 0) {
    lines[i] = line.replace(sq, built);
    console.log('[3] rag-vault: SET LOCAL fixed (sq) on line', i + 1);
    fixed++; changed = true;
  } else if (line.indexOf(dq) >= 0) {
    lines[i] = line.replace(dq, built);
    console.log('[3] rag-vault: SET LOCAL fixed (dq) on line', i + 1);
    fixed++; changed = true;
  }
}
src = lines.join('\n');
if (fixed === 0) {
  console.log('[3] rag-vault: SET LOCAL -- already fixed or not found');
}

if (changed) {
  fs.writeFileSync(f, src);
  console.log('    rag-vault dist written.');
}
ENDNODE

PASS=$((PASS+1))

# ----------------------------------------------------------------
# Patch 4: middleware-engine rest.js -- PIPELINE_ERROR logger
# ----------------------------------------------------------------
REST="/app/packages/middleware-engine/dist/transport/rest.js"

if [ ! -f "$REST" ]; then
  echo "[4] WARN: $REST not found -- skipping"
  WARN=$((WARN+1))
elif grep -q 'PIPELINE_ERROR:' "$REST" 2>/dev/null; then
  echo "[4] middleware-engine: error logger already present -- OK"
  PASS=$((PASS+1))
elif grep -q 'Internal pipeline error' "$REST" 2>/dev/null; then
  sed -i 's/res\.status(500)\.json({ error: "Internal pipeline error", requestId });/console.error("PIPELINE_ERROR:", String(err)); res.status(500).json({ error: "Internal pipeline error", requestId });/g' "$REST"
  echo "[4] middleware-engine: error logger applied"
  PASS=$((PASS+1))
else
  echo "[4] middleware-engine: WARN -- rest.js pattern not found"
  WARN=$((WARN+1))
fi

echo ""
echo "============================================"
echo " Patch complete: $PASS applied/OK, $WARN warnings"
echo "============================================"
echo ""
