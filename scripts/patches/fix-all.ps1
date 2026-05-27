$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"
$API_URL   = "http://localhost:3001"
$TENANT_ID = "0be7a2cd-43c7-42c4-a439-8307577255ac"
$OAI_KEY   = "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"

Write-Host "[1/7] Patching OPENAI_API_KEY" -ForegroundColor Cyan
(Get-Content .env) -replace "OPENAI_API_KEY=.*","OPENAI_API_KEY=$OAI_KEY" | Set-Content .env -Encoding UTF8

Write-Host "[2/7] Force-recreating middleware-engine" -ForegroundColor Cyan
docker compose up -d --force-recreate middleware-engine
Start-Sleep 8
Write-Host "      health: $((Invoke-RestMethod $API_URL/health).status)"

Write-Host "[3/7] Re-applying canonicalize patch" -ForegroundColor Cyan
@'
import { readFileSync, writeFileSync } from 'fs';
const p = '/app/packages/evidence-fabric/dist/index.js';
let s = readFileSync(p, 'utf8');
s = s.replace('const canonicalize = __require("json-canonicalize");',
              'const canonicalize = __require("json-canonicalize").canonicalize;');
writeFileSync(p, s);
console.log('patch ok:', s.includes('canonicalize").canonicalize'));
'@ | Set-Content _c.mjs -Encoding UTF8
docker cp _c.mjs middleware-engine:/tmp/_c.mjs
Remove-Item _c.mjs
docker exec --user root middleware-engine node /tmp/_c.mjs

Write-Host "[4/7] Schema check + partition + grants" -ForegroundColor Cyan
docker exec cos-plus psql -U cos_admin ios_plus -c "\d rag_chunks"
docker exec cos-plus psql -U cos_admin ios_plus -c "GRANT INSERT, SELECT ON ALL TABLES IN SCHEMA public TO rag_writer;"
@'
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'rag_chunks_xsc') THEN
    EXECUTE 'CREATE TABLE rag_chunks_xsc PARTITION OF rag_chunks FOR VALUES IN (''XSC-CROSS-CUTTING'')';
    RAISE NOTICE 'partition created';
  ELSE
    RAISE NOTICE 'partition already exists';
  END IF;
END
$do$;
'@ | Set-Content _part.sql -Encoding UTF8
docker cp _part.sql cos-plus:/tmp/_part.sql
Remove-Item _part.sql
docker exec cos-plus psql -U cos_admin ios_plus -f /tmp/_part.sql

Write-Host "[5/7] Seeding RAG chunks with real embeddings" -ForegroundColor Cyan
@'
import OpenAI from 'openai';
import pg from 'pg';
const { Pool } = pg;
const ai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({ host: process.env.COS_HOST, port: parseInt(process.env.COS_PORT||'5432'),
  database: process.env.COS_DATABASE, user: 'rag_writer', password: process.env.COS_PASSWORD_RAG_WRITER, ssl: false });
const SC = 'XSC-CROSS-CUTTING';
const CHUNKS = [
  { node:'UCO-XSC-5001', text:'FISMA 2014 requires federal IT contractors to implement NIST SP 800-53 security controls, develop System Security Plans, conduct annual security assessments, perform continuous monitoring, and report incidents within one hour of discovery. NIST Risk Management Framework authorization is mandatory before operating any federal information system. Contractors must submit annual FISMA metrics to OMB and CISA. Unauthorized access incidents require US-CERT notification within one hour.' },
  { node:'UCO-XSC-5002', text:'NIST SP 800-171 Rev 3 establishes 110 security requirements across 14 control families for CUI protection: Access Control, Awareness and Training, Audit and Accountability, Configuration Management, Identification and Authentication, Incident Response, Maintenance, Media Protection, Personnel Security, Physical Protection, Risk Assessment, Security Assessment, System and Communications Protection, and System and Information Integrity. Federal contractors must submit Supplier Performance Risk System scores reflecting compliance posture before contract award.' },
  { node:'UCO-XSC-5003', text:'CMMC 2.0 Level 2 requires third-party C3PAO certification for DoD contracts with CUI. DFARS 252.204-7012 mandates 72-hour incident reporting to DC3 and 90-day image preservation. Contractors must maintain SPRS scores before award. FedRAMP Moderate or High authorization is required for cloud services to federal agencies under the FedRAMP Authorization Act. Authorized cloud offerings require annual third-party assessments and monthly vulnerability scanning to maintain authorization.' },
  { node:'UCO-XSC-5004', text:'Section 889 NDAA FY2019 and FAR 52.204-24 prohibit covered telecommunications from Huawei, ZTE, Hytera, Hikvision, and Dahua in federal contracts. NIST SP 800-161 Rev 1 requires ICT supply chain risk management including hardware, software, and provider vetting. Annual reviews of supplier lists and software bills of materials are required for DoD IT contracts. Contractors must represent compliance in SAM.gov offeror representations updated annually.' },
  { node:'UCO-XSC-5005', text:'Federal contractors must maintain active SAM.gov registration throughout contract performance. E-Verify under FAR 52.222-54 is required for contracts over $3500 with 120 or more days on federal premises. FAR 52.203-13 mandates a written code of business ethics for contracts over $5.5 million lasting 120 days or more. Equal opportunity under Executive Order 11246 and FAR 52.222-26 applies to all contracts over $10000 and requires EEO notice posting at all worksites.' }
];
const client = await pool.connect();
try {
  const sch = await client.query("SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='rag_chunks' ORDER BY ordinal_position");
  console.log('cols:', sch.rows.map(r=>r.column_name+(r.is_nullable==='NO'&&!r.column_default?'*':'')).join(', '));
  const hasSrc  = sch.rows.some(r=>r.column_name==='source_id');
  const srcReq  = hasSrc && sch.rows.find(r=>r.column_name==='source_id').is_nullable==='NO' && !sch.rows.find(r=>r.column_name==='source_id').column_default;
  let srcId = null;
  if (srcReq) {
    const r = await client.query("INSERT INTO rag_sources(sector_code,uco_node_id,title,source_type,content_hash,embedding_model,metadata) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING source_id",
      [SC,'UCO-XSC-5001','IOS+ XSC Compliance KB','regulation','xsc-seed-v1-'+Date.now(),'text-embedding-3-large','{"seeded":true}']);
    srcId = r.rows[0].source_id;
    console.log('source_id:', srcId);
  }
  for (let i=0; i<CHUNKS.length; i++) {
    const {node,text} = CHUNKS[i];
    process.stdout.write('  ['+(i+1)+'/'+CHUNKS.length+'] '+node+' ... ');
    const emb = await ai.embeddings.create({model:'text-embedding-3-large',input:text,dimensions:3072});
    const vec = '['+emb.data[0].embedding.join(',')+']';
    if (srcReq && srcId) {
      await client.query('INSERT INTO rag_chunks(source_id,sector_code,uco_node_id,chunk_index,chunk_text,embedding,token_count,metadata) VALUES($1,$2,$3,$4,$5,$6::vector,$7,$8)',
        [srcId,SC,node,i,text,vec,Math.ceil(text.length/4),'{"seeded":true}']);
    } else {
      await client.query('INSERT INTO rag_chunks(sector_code,uco_node_id,chunk_index,chunk_text,embedding,token_count,metadata) VALUES($1,$2,$3,$4,$5::vector,$6,$7)',
        [SC,node,i,text,vec,Math.ceil(text.length/4),'{"seeded":true}']);
    }
    console.log('ok');
  }
  console.log('Seeded',CHUNKS.length,'chunks into',SC);
} finally { client.release(); await pool.end(); }
'@ | Set-Content _seed.mjs -Encoding UTF8
docker cp _seed.mjs middleware-engine:/app/_seed.mjs
Remove-Item _seed.mjs
docker exec -w /app middleware-engine node _seed.mjs

Write-Host "[6/7] Restarting (preserving patches)" -ForegroundColor Cyan
docker restart middleware-engine
Start-Sleep 6
Write-Host "      health: $((Invoke-RestMethod $API_URL/health).status)"
docker exec cos-plus psql -U cos_admin ios_plus -c "SELECT COUNT(*) AS xsc_chunks FROM rag_chunks_xsc;"

Write-Host "[7/7] Smoke test" -ForegroundColor Cyan
$body = @{ input="What are the FISMA compliance requirements for IT federal contractors?"; metadata=@{source="smoke-test"} } | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$API_URL/v1/inference" -Method POST -ContentType "application/json" `
        -Headers @{"x-tenant-id"=$TENANT_ID;"x-session-id"=[guid]::NewGuid().ToString()} -Body $body | ConvertTo-Json -Depth 10
} catch {
    Write-Host "HTTP $($_.Exception.Response.StatusCode.value__): $($_.ErrorDetails.Message)" -ForegroundColor Red
}
docker compose logs middleware-engine --tail=10
docker exec cos-plus psql -U cos_admin ios_plus -c "SELECT package_id,event_type,layer_depth,published_at FROM evidence_packages ORDER BY published_at DESC LIMIT 5;"
docker exec cos-plus psql -U cos_admin ios_plus -c "SELECT decision_id,policy_action,decided_at FROM gate_decisions ORDER BY decided_at DESC LIMIT 5;"
