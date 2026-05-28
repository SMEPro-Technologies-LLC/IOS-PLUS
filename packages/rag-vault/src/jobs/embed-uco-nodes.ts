import OpenAI from 'openai';
import pg from 'pg';

const { Pool } = pg;

// Helper to generate a deterministic unit vector of specified dimensions
function generateMockVector(seedText: string, dimensions = 1536): number[] {
  const vector: number[] = [];
  let sumSq = 0;
  for (let i = 0; i < dimensions; i++) {
    const charCode = seedText.charCodeAt(i % seedText.length) || 0;
    const hash = Math.sin(charCode + i) * 10000;
    const val = hash - Math.floor(hash);
    vector.push(val);
    sumSq += val * val;
  }
  const norm = Math.sqrt(sumSq) || 1.0;
  return vector.map(v => v / norm);
}

async function main() {
  console.log('[INFO] UCO Embedding Job starting...');

  const dbUrl = process.env['DATABASE_URL_RAG_WRITER'];
  if (!dbUrl) {
    console.error('[ERROR] DATABASE_URL_RAG_WRITER environment variable is not defined.');
    process.exit(1);
  }

  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    console.warn('[WARNING] OPENAI_API_KEY is not defined. Fallback to mock embeddings mode.');
  }

  const pool = new Pool({
    connectionString: dbUrl,
    connectionTimeoutMillis: 10000,
  });

  const openai = apiKey ? new OpenAI({ apiKey }) : null;

  try {
    // 1. Check if vector_embedding column exists in uco_nodes
    const schemaCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'uco_nodes' AND column_name = 'vector_embedding'
    `);
    
    if (schemaCheck.rows.length === 0) {
      console.warn('[WARNING] Column uco_nodes.vector_embedding is missing. Running local schema update...');
      await pool.query('ALTER TABLE uco_nodes ADD COLUMN IF NOT EXISTS vector_embedding vector(1536)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_uco_nodes_vector_embedding ON uco_nodes USING hnsw (vector_embedding vector_cosine_ops) WITH (m=16, ef_construction=200)');
      console.log('[INFO] Successfully added vector_embedding column and HNSW index.');
    }

    // 2. Fetch nodes that require embedding
    const { rows: nodes } = await pool.query(`
      SELECT uco_node_id, regulation_name, specific_activity, cfr_usc_citation, penalties_consequences 
      FROM uco_nodes 
      WHERE vector_embedding IS NULL
    `);

    console.log(`[INFO] Found ${nodes.length} nodes needing embeddings.`);
    if (nodes.length === 0) {
      console.log('[INFO] All UCO nodes are already embedded. Job complete.');
      process.exit(0);
    }

    // 3. Process in batches
    const batchSize = 100;
    for (let i = 0; i < nodes.length; i += batchSize) {
      const batch = nodes.slice(i, i + batchSize);
      console.log(`[INFO] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(nodes.length / batchSize)} (size: ${batch.length})...`);

      const texts = batch.map(row => {
        return [row.regulation_name, row.specific_activity, row.cfr_usc_citation, row.penalties_consequences]
          .filter(Boolean)
          .join(' ')
          .trim();
      });

      let embeddings: number[][] = [];
      if (openai) {
        try {
          const resp = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: texts,
            dimensions: 1536,
          });
          embeddings = resp.data.map(d => d.embedding);
          console.log(`[INFO] Successfully fetched ${embeddings.length} embeddings from OpenAI API.`);
        } catch (err) {
          console.warn(`[WARNING] OpenAI API embedding generation failed: ${String(err)}. Falling back to mock embeddings for this batch.`);
          embeddings = batch.map(row => generateMockVector(row.uco_node_id, 1536));
        }
      } else {
        embeddings = batch.map(row => generateMockVector(row.uco_node_id, 1536));
      }

      // 4. Update the database
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let j = 0; j < batch.length; j++) {
          const node = batch[j];
          const emb = embeddings[j];
          if (!emb) {
            console.warn(`[WARNING] Missing embedding for node: ${node.uco_node_id}`);
            continue;
          }
          const embStr = `[${emb.join(',')}]`;
          await client.query(
            `UPDATE uco_nodes SET vector_embedding = $1::vector WHERE uco_node_id = $2`,
            [embStr, node.uco_node_id]
          );
        }
        await client.query('COMMIT');
        console.log(`[INFO] Committed batch updates.`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('[ERROR] Batch transaction failed, rolled back:', err);
        throw err;
      } finally {
        client.release();
      }
    }

    console.log('[INFO] All UCO node embeddings updated successfully!');
  } catch (err) {
    console.error('[ERROR] Job failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[FATAL] Unhandled rejection:', err);
  process.exit(1);
});
