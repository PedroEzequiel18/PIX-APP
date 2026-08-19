# Movimentações Diárias - Geraldo Davi

App para registrar movimentações Pix diárias, com leitura automática de comprovantes (print) via IA.

## O que você precisa antes de publicar

1. **Uma chave da API da Anthropic**
   - Crie uma conta em https://console.anthropic.com
   - Vá em "API Keys" e gere uma chave (começa com `sk-ant-...`)
   - Guarde essa chave — você vai colar ela como variável de ambiente na hospedagem, nunca no código.

2. **Um banco de dados no Neon** (para os dados não se perderem)
   - Crie uma conta em https://neon.tech (tem plano gratuito)
   - Crie um novo projeto (pode aceitar as opções padrão)
   - Na tela do projeto, copie a **Connection String** (algo como `postgresql://usuario:senha@ep-xxxxx.neon.tech/neondb?sslmode=require`)
   - Guarde essa string — é o `DATABASE_URL` que você vai colar na hospedagem. Você não precisa criar tabelas manualmente: o app cria a tabela `entries` sozinho na primeira vez que rodar.

3. **Uma senha de acesso** (recomendado, já que o link vai para o cliente)
   - Escolha qualquer senha. Ela vai proteger o app pra só quem tem a senha conseguir ver/editar as movimentações.

## Como publicar (passo a passo com Render.com — gratuito)

1. Crie uma conta em https://render.com (dá pra entrar com GitHub).
2. Suba esta pasta para um repositório no GitHub (crie um repositório novo e envie estes arquivos).
3. No Render, clique em **New +** → **Web Service** → conecte o repositório.
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Em **Environment Variables**, adicione:
   - `ANTHROPIC_API_KEY` = sua chave da Anthropic
   - `DATABASE_URL` = a connection string do Neon
   - `APP_PASSWORD` = a senha que você escolheu
6. Clique em **Create Web Service** e aguarde o deploy (leva 1–2 minutos).
7. Pronto — o Render te dá um link tipo `https://movimentacoes-diarias.onrender.com`. Esse é o link que você manda pro seu cliente.

> Alternativas ao Render: Railway.app e Fly.io funcionam de forma parecida (conectar repositório, configurar variáveis de ambiente, publicar).

## Sobre os dados salvos

Agora os lançamentos ficam salvos no Neon (Postgres), não em um arquivo local — então não tem risco de perder dados quando o servidor "dorme" no plano gratuito do Render. O app cria a tabela `entries` automaticamente na primeira vez que conecta ao banco.

## Rodando localmente para testar

```bash
npm install
cp .env.example .env   # depois edite o .env com sua chave e senha
npm start
```

Acesse http://localhost:3000
