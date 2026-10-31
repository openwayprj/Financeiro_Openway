# Openway Financeiro

Sistema de **Contas a Pagar e Contas a Receber** — gestão **Pessoal e Empresarial** no mesmo ambiente, com dashboard executivo, rateio por colaborador e login.

## Banco de dados: PostgreSQL (Neon)

Os dados ficam em um banco **PostgreSQL no Neon** (não há mais arquivo `financeiro.db`). O sistema lê a conexão de
`DATABASE_URL`:

- **No seu computador**: arquivo `.env.local` na pasta do sistema (modelo em `.env.example`). **Nunca envie esse arquivo ao Git** (já está no `.gitignore`).
- **No Netlify**: *Site configuration → Environment variables → `DATABASE_URL`*.

Use a string do Neon com **pooling** (host com `-pooler`) e `sslmode=require`.
As tabelas são criadas automaticamente no primeiro acesso (ou com `npm run db:setup`).

### Migrar os dados do SQLite antigo (uma única vez)

1. Feche o sistema. 2. Na pasta do projeto:

```bash
npm install
npm run db:migrar                       # lê data/financeiro.db
npm run db:migrar -- --arquivo "C:\caminho\outro\financeiro.db"   # se o banco estiver em outra pasta
npm run db:migrar -- --limpar           # refazer: apaga o que já está no Postgres e copia de novo
```

O script copia tudo em **uma transação** (ou grava tudo, ou nada) e imprime a conferência de quantidades e somas de valores entre origem e destino. As sessões de login não são migradas (é preciso entrar de novo).

## Como executar no seu computador (Windows)

1. Instale o **Node.js 24 LTS** (mínimo 22.13) em https://nodejs.org (se ainda não tiver).
2. Crie o arquivo **`.env.local`** com a `DATABASE_URL` (veja acima).
3. Dê dois cliques em **`iniciar.bat`** (na primeira vez instala as dependências). O navegador abre em `http://localhost:3000`.

```bash
npm install
npm run seed      # opcional: dados de demonstração (só com o banco sem lançamentos)
npm start         # http://localhost:3000
npm test          # testes da API — exige TEST_DATABASE_URL de um banco DESCARTÁVEL (apaga as tabelas!)
```

### Configurações (variáveis de ambiente)

| Variável | Padrão | Uso |
|---|---|---|
| `DATABASE_URL` | — (obrigatória) | Conexão PostgreSQL/Neon |
| `PORT` | `3000` | Porta HTTP (uso local) |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` para permitir acesso de outros computadores da rede |
| `DB_POOL_MAX` | `8` (local) / `3` (Netlify) | Conexões simultâneas com o banco |

Todas as datas e o "hoje" do sistema seguem o **horário de Brasília**, inclusive no Netlify.

## Publicar no Netlify

1. Envie o projeto para um repositório Git (GitHub/GitLab) — `.env.local`, `data/` e `node_modules/` não vão (estão no `.gitignore`).
2. No Netlify: *Add new site → Import an existing project* e escolha o repositório. O `netlify.toml` já define build, pasta publicada (`public`), a função da API e os redirecionamentos.
3. Em *Environment variables*, crie **`DATABASE_URL`** com a string do Neon.
4. Faça o deploy. O front-end é servido pelo CDN e a API (`/api/*`) roda como Netlify Function (`netlify/functions/api.js`).
5. Alerta diário por e-mail: a função agendada `netlify/functions/alerta-agendado.js` roda a cada 30 minutos e envia o resumo do dia depois do horário configurado (uma vez por dia). Configure SMTP e horário em *Administração → Alertas*.

Limites do Netlify a considerar: requisições de até ~6 MB (planilhas de importação grandes demais não passam; use arquivos menores ou rode o sistema localmente para cargas grandes) e tempo máximo de 10 s por requisição no plano gratuito.
O agendamento do Windows (`agendar-alerta.bat`) continua disponível apenas quando o sistema roda localmente — não use os dois ao mesmo tempo (o alerta não duplica no mesmo dia, mas evite confusão).

## Backup e restauração

- **Pela tela Administração → Backup**: gera uma cópia lógica (`.json.gz`) de todos os dados, guardada no próprio banco (as 30 mais recentes) e baixada pelo navegador. Para restaurar: `npm run db:restaurar -- caminho\backup.json.gz --confirmar`.
- **Neon (recomendado como segunda camada)**: o Neon guarda o histórico do banco e permite *Restore* a um instante anterior pelo painel (a janela depende do seu plano). Antes de mudanças grandes, crie uma *branch* do banco no Neon.
- Zerar o banco pela tela faz um backup automático antes.

## Funcionalidades

- **Dashboard executivo**: filtros globais de período (Este Mês, Mês Anterior, Próximo Mês, Ano Atual ou intervalo livre) e âmbito (Todas / Apenas Pessoal / Apenas Empresa); KPIs de Total Previsto, Total Realizado, Resultado Previsto e Resultado Realizado; gráfico Receber x Pagar no tempo (previsto x realizado); rosca de status (Realizado / Pendente / Em Atraso); ranking de receitas por colaborador; despesas atreladas a colaboradores; top categorias; próximos vencimentos.
- **Calendário Financeiro**: visão estilo Outlook por **Dia / Semana / Mês** com os títulos a receber (verde) e a pagar (vermelho) em cada dia; totais por dia, por semana (coluna lateral no mês) e do período (a receber, a pagar, saldo, quitado x em aberto); quitados riscados, atrasados destacados; filtros Pessoal/Empresa, Receber/Pagar e mostrar quitados; clique no título para ver detalhes, baixar, estornar, editar ou excluir; "+" no dia cria lançamento já com o vencimento; atalhos ← → (navegar), T (hoje), D/S/M (visão).
- **Contas a Receber / Pagar**: número de documento sequencial automático, filtros (status, categoria, colaborador, data de referência), baixa e estorno, exportação CSV.
- **Projetar Mês**: copia os lançamentos de um mês (Receber, Pagar ou ambos; Pessoal, Empresa ou ambos) para outro mês, **sem data de pagamento**. Permite desmarcar itens e ajustar valores antes de gerar, avisa quando um título já foi projetado para o mês de destino e mantém rateio, centro de custo e demais dados. Acesso pelo menu ou pelo botão *Projetar mês* nas telas de Contas a Receber/Pagar.
- **Importação Diária (Google Sheets)**: botão **Gerar planilha modelo** (aba *Lançamentos* + abas com Fornecedores, Clientes, Categorias, Formas de Pagamento, Centros de Custo e Colaboradores, com listas de seleção e instruções). A planilha fica no Google Sheets compartilhada por link (leitor); todo dia você informa a data (emissão, vencimento, pagamento ou todas) e o sistema lê a planilha, mostra a prévia e lança Pagar e Receber de uma vez. Linhas já importadas são ignoradas (controle por ID ou impressão digital da linha), uma Data de Pagamento preenchida depois vira **baixa** do título, títulos iguais lançados à mão aparecem como *possível duplicado*, nomes parecidos são ajustados ao cadastro e cadastros novos são criados. Também aceita o arquivo .xlsx/.csv.
- **Importar Planilha — outros formatos (Contas a Pagar e a Receber)**: lê .xlsx/.csv (com escolha da aba) pelo cabeçalho (Fornecedor/Cliente — ou duas colunas Descrição —, Descrição, Tipo P/E, Vencimento, Valor, Categoria, Centro de Custo e opcionais); em Receber usa o colaborador responsável padrão informado; cria automaticamente fornecedores, categorias (natureza pelo tipo P/E) e centros de custo, unifica nomes parecidos, mostra prévia com pendências editáveis e grava tudo numa transação.
- **Alertas por E-mail (somente administradores)**: resumo diário (padrão 08:00) com as contas a pagar do dia, em atraso e dos próximos dias, e opcionalmente o que há para receber; na sexta inclui o fim de semana. Envio por SMTP próprio (Gmail com *senha de app*), prévia do e-mail, botão de envio imediato e agendamento automático no **Agendador de Tarefas do Windows** (pela tela ou por `agendar-alerta.bat`; remover com `remover-alerta.bat`). No Netlify o envio é automático (função agendada); no Windows, funciona com o sistema fechado e, se o PC estiver desligado no horário, envia assim que ligar (uma vez por dia). Log local em `data/logs/alerta-email.log`.
- **Manutenção do Banco (somente administradores)**: zera os lançamentos (ou lançamentos e cadastros) com backup automático (guardado no banco) e reinicia a numeração.
- **Rateio por colaborador (opcional)**: em cada título, informe um ou mais colaboradores e o valor de cada um. O saldo não rateado fica com o colaborador responsável.
- **Centro de Custo (Contas a Pagar)**: campo opcional no lançamento, filtro na lista, card no dashboard e tela **Resumo por Centro de Custo** com evolução mensal empilhada, participação %, demonstrativo (previsto, realizado, % executado, em aberto, em atraso), categorias e fornecedores por centro, extrato de títulos e exportação CSV.
- **Resumo por Colaborador**: receita trazida x despesa gerada, saldo previsto e realizado, extrato de títulos por colaborador.
- **Cadastros**: Categorias/Plano de Contas, Clientes, Fornecedores, Colaboradores, Formas de Pagamento, Contas Bancárias e Usuários.
- **Regras**: status derivado da data de pagamento; categoria deve ser do mesmo ambiente do título (Princípio da Entidade); CPF/CNPJ validado; cadastros em uso não podem ser excluídos (inative-os).

## Documentação técnica

- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — modelo de dados, regras de negócio, regras de cálculo do dashboard, endpoints e layout.
- [`database/schema.sql`](database/schema.sql) — schema PostgreSQL (tabelas, índices e views).
- [`database/schema.prisma`](database/schema.prisma) — mesmas entidades em Prisma (referência histórica — o schema em uso é o `database/schema.sql`).
