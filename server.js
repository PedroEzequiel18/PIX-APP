const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || ''; // deixe vazio para não exigir senha
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL; // string de conexão do Neon

if (!ANTHROPIC_API_KEY) {
  console.warn('AVISO: ANTHROPIC_API_KEY não definida. A leitura automática do print não vai funcionar até você configurá-la.');
}
if (!DATABASE_URL) {
  console.warn('AVISO: DATABASE_URL não definida. Configure a string de conexão do Neon para os dados serem salvos.');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false } // exigido pelo Neon
});

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('recebido', 'enviado')),
      category TEXT NOT NULL DEFAULT 'pessoal',
      amount NUMERIC NOT NULL,
      description TEXT DEFAULT '',
      entry_date DATE NOT NULL,
      entry_time TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- autenticação simples por senha (opcional) ---
function requireAuth(req, res, next) {
  if (!APP_PASSWORD) return next();
  const sent = req.header('x-app-password');
  if (sent === APP_PASSWORD) return next();
  return res.status(401).json({ error: 'Senha incorreta ou ausente.' });
}

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!APP_PASSWORD) return res.json({ ok: true, passwordRequired: false });
  if (password === APP_PASSWORD) return res.json({ ok: true, passwordRequired: true });
  return res.status(401).json({ ok: false, error: 'Senha incorreta.' });
});

app.get('/api/config', (req, res) => {
  res.json({ passwordRequired: Boolean(APP_PASSWORD) });
});

function rowToEntry(row) {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    amount: Number(row.amount),
    description: row.description || '',
    date: row.entry_date.toISOString ? row.entry_date.toISOString().slice(0, 10) : row.entry_date,
    time: row.entry_time || ''
  };
}

// --- CRUD de lançamentos ---
app.get('/api/entries', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM entries ORDER BY created_at DESC');
    res.json(rows.map(rowToEntry));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao ler os dados do banco.' });
  }
});

app.post('/api/entries', requireAuth, async (req, res) => {
  const { type, category, amount, description, date } = req.body || {};
  if (!amount || Number(amount) <= 0 || !['recebido', 'enviado'].includes(type) || !date) {
    return res.status(400).json({ error: 'Dados inválidos.' });
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const cat = category === 'empresarial' ? 'empresarial' : 'pessoal';
  try {
    const { rows } = await pool.query(
      `INSERT INTO entries (id, type, category, amount, description, entry_date, entry_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, type, cat, Number(amount), (description || '').trim(), date, time]
    );
    res.json(rowToEntry(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar no banco.' });
  }
});

app.delete('/api/entries/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM entries WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao excluir no banco.' });
  }
});

// --- leitura automática do print via API da Anthropic (chave fica só no servidor) ---
app.post('/api/extract', requireAuth, async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada no servidor.' });
  }
  const { imageBase64, mediaType } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });

  const today = new Date().toISOString().slice(0, 10);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
              {
                type: 'text',
                text: `Este é um print de comprovante de transferência PIX. Extraia os dados e responda APENAS com um objeto JSON, sem texto antes ou depois, sem markdown, no formato exato:
{"amount": <numero, valor em reais, ex: 150.50>, "type": "recebido" ou "enviado", "category": "pessoal" ou "empresarial" (avalie pelo nome, descrição ou natureza do pagamento; sem indício, use "pessoal"), "description": "<nome de quem enviou/recebeu, se visível>", "date": "<YYYY-MM-DD, use a data do comprovante; se não identificar, use ${today}>"}
Faça a melhor estimativa possível, mas sempre retorne o JSON.`
              }
            ]
          }
        ]
      })
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('Erro da API Anthropic:', data);
      return res.status(502).json({ error: 'Erro ao consultar a IA.' });
    }
    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) return res.status(502).json({ error: 'Resposta vazia da IA.' });
    const clean = textBlock.text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Falha ao processar o print.' });
  }
});

ensureTable()
  .then(() => {
    app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('Erro ao conectar/preparar o banco de dados Neon:', err);
    // sobe o servidor mesmo assim, para as rotas que não dependem do banco (ex: static files) continuarem acessíveis
    app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT} (SEM banco de dados conectado)`));
  });
