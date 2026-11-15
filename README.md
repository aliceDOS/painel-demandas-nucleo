# Núcleo de Articulação — Kanban do Gabinete

Projeto em React + TypeScript + Vite. Dados no Supabase/PostgreSQL; arquivos binários no Google Drive; interface hospedável no GitHub Pages. **Versão-base para implantação e homologação**, não copie credenciais reais para arquivos públicos.

## Funcionalidades

- Cinco colunas fixas: **Backlog → Em análise → Em andamento → Em validação → Concluído**.
- Criar/editar tarefas, prioridades, responsáveis, prazos, bairros e localização.
- Checklist persistido no Supabase. Ao marcar o **último item pendente**, um trigger PostgreSQL avança automaticamente **uma coluna**. Não avança checklists vazios nem retrocede ao desmarcar um item.
- Descrição normal, editável, **sem prévia formatada**.
- Mapa **Padrão** e **Satélite** (MapTiler). Busca de **qualquer bairro ou endereço**, independentemente de haver tarefas cadastradas. Marcadores das tarefas com latitude/longitude.
- Anexos: escolher **várias fotos e PDFs** de uma vez, visualizar miniaturas e PDFs na tarefa, progresso por arquivo, remoção com confirmação e autorização no servidor.
- Comentários, pessoas vinculadas (somente nomes), atualização em tempo real (Postgres Changes) e indicadores com dados reais.
- Acesso institucional por e-mail com papéis `admin`, `editor` e `viewer`.

## 1. Requisitos

- Node.js 22+, npm, Git, VS Code.
- Projeto **novo** no Supabase (para não sobrescrever a base antiga), Supabase CLI (para implantar Edge Functions).
- Conta MapTiler, com chave de navegador **restrita aos domínios** que hospedarão a interface. MapTiler pode cobrar por uso acima da franquia.
- Google Cloud Project com **Google Drive API habilitada**, consentimento OAuth e cliente OAuth 2.0 com `client_id`, `client_secret` e **refresh_token**. A conta autorizada precisa ter permissão de escrita na pasta de destino. O uso de dados privados requer revisar as políticas da prefeitura, LGPD e regras do Google.

## 2. Frontend local (VS Code)

```bash
npm install
cp .env.example .env
```

Edite `.env` com:

- `VITE_SUPABASE_URL`: URL pública do projeto Supabase.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: chave `sb_publishable_...` (pública, RLS obrigatória).
- `VITE_MAPTILER_KEY`: chave pública MapTiler com restrição de domínio.

```bash
npm run dev
npm run build
```

Em localhost acesse `http://localhost:5173`. As variáveis `VITE_` tornam-se públicas no navegador: nunca use chave `sb_secret_`, `service_role`, `GOOGLE_CLIENT_SECRET` ou `GOOGLE_REFRESH_TOKEN` aqui.

## 3. Banco Supabase

1. Crie projeto novo e backup/exporte a estrutura/dados do projeto antigo (se houver).
2. No **SQL Editor**, execute `supabase/migrations/001_schema.sql` **uma vez**.
3. Em **Authentication > URL Configuration**, inclua as URLs de redirecionamento do localhost e do seu site GitHub Pages.
4. Configure o e-mail de acesso (OTP/magic link) no Supabase Auth. Atenção a limitações do servidor de e-mail padrão.
5. Entre no sistema com o primeiro e-mail para criar seu registro em `profiles`.
6. No SQL Editor, com o UUID do usuário obtido em **Authentication > Users**, execute:

```sql
update public.profiles
set role='admin', is_active=true
where id='COLE-AQUI-UUID-DO-GESTOR';
```

7. Cada novo colaborador inicia **inativo**. O administrador libera somente os e-mails autorizados:

```sql
update public.profiles
set role='editor', is_active=true
where id='UUID-DO-COLABORADOR';
-- Para acesso de leitura, use role='viewer'.
```

Não publique essas instruções com UUIDs reais. Não permita cadastro anônimo com edição.

## 4. Google Drive: credenciais de servidor

A API funciona **no Drive da conta Google autorizada** por OAuth (por exemplo, conta institucional). A pasta precisa existir. Utilize a ID da pasta **sem expor as credenciais**. O código armazena todos os anexos nessa pasta, com prefixo identificando a tarefa. Cada anexo é associado à tarefa no banco, e é carregado por sua ID no app.

Prepare um projeto no Google Cloud, habilite a **Drive API** e crie o consentimento OAuth. Obtenha um `refresh_token` autorizado para a mesma conta proprietária/gestora da pasta e para um escopo Drive suficiente; preferencialmente escolha o menor escopo compatível com a pasta. Em ambientes institucionais, o administrador deve aprovar este acesso. Uma app em modo de teste pode ter refresh tokens com validade reduzida; revise estado de publicação/consentimento antes de usar em produção.

No terminal (com a CLI Supabase instalada e autenticada):

```bash
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase secrets set \
  NUCLEO_PUBLISHABLE_KEY="sb_publishable_..." \
  NUCLEO_SECRET_KEY="sb_secret_..." \
  GOOGLE_CLIENT_ID="...apps.googleusercontent.com" \
  GOOGLE_CLIENT_SECRET="..." \
  GOOGLE_REFRESH_TOKEN="..." \
  GOOGLE_DRIVE_FOLDER_ID="..." \
  ALLOWED_ORIGINS="http://localhost:5173,https://SEUUSUARIO.github.io"
supabase functions deploy drive-file
```

**Segurança:** a Edge Function verifica o JWT de login, consulta `profiles` com credencial apenas do servidor e valida permissões `editor/admin`. Downloads só ficam disponíveis a membros ativos. Arquivos no Drive devem permanecer **privados**, sem link público. Não compartilhe a pasta com "Qualquer pessoa com o link".

**Limites escolhidos:** imagens JPG/PNG/WEBP até **8 MB**, PDF até **15 MB**, no máximo **60 anexos por tarefa**. A barra de progresso do navegador mede a transferência **até a Edge Function**. O período de envio da função ao Google Drive não fornece percentual incremental ao navegador — por isso o indicador fica perto de 95% até confirmação final. O Drive usa sessão de upload resumable, mas esta versão não salva o estado do upload do navegador para retomada automática de uploads interrompidos.

## 5. Mapa padrão e satélite

O mapa usa o SDK MapTiler. Insira a chave restrita em `VITE_MAPTILER_KEY`; as opções Padrão e Satélite alternam estilos. A busca é feita pela **API de geocodificação do MapTiler**, mesmo sem tarefa cadastrada no bairro. O primeiro resultado encontrado pode ser aproximado — confira a localização antes de depender dele. Para mostrar um cartão como pino, clique em **Localizar no mapa** dentro da tarefa e depois em **Salvar tarefa**.

## 6. Publicação GitHub Pages

1. Crie repositório GitHub (privado para o código, se necessário) e envie os arquivos **sem o `.env`**.
2. Em **Settings > Secrets and variables > Actions > Variables**, crie:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_MAPTILER_KEY`
3. Em **Settings > Pages**, selecione **GitHub Actions** como fonte.
4. Envie (`push`) na branch `main`; o workflow `.github/workflows/deploy.yml` faz build, publica `dist` e configura base `/NOME-DO-REPOSITORIO/`.
5. Atualize `ALLOWED_ORIGINS` nas Edge Functions com **somente** a origem `https://SEUUSUARIO.github.io` (sem o caminho do repositório). Configure também o redirect URL completo no Supabase Auth.

O GitHub Pages hospeda apenas o frontend estático. **Nenhuma chave privada pode ficar no GitHub Pages.**

## 7. Integração e dados antigos

A migração de **tabelas legadas** não é automática: o banco anterior pode conter nomes/formatos distintos e campos pessoais. Não execute este SQL por cima do Supabase atual. A forma segura é exportar as tabelas antigas, mapear seus campos para `tasks`, `checklist_items`, `task_comments`, `task_people`, `task_attachments`, testar em base nova e só então trocar a URL de produção. Arquivos antigos armazenados no Supabase Storage ou em outro Drive exigem migração própria e conciliação de IDs. Faça backup e teste os registros antes da publicação.

## 8. Verificações antes de produção

- Acesso de visualizador não pode alterar tarefas nem anexos.
- Usuário pendente/inativo não pode ler dados do Gabinete.
- Confira criação de tarefa e sincronização com dois navegadores.
- Clique no último item do checklist e verifique que avançou **uma etapa**, sem ultrapassar Concluído.
- Execute `supabase/tests/checklist_automatico.sql` no SQL Editor para verificar o trigger numa transação descartável (faz `ROLLBACK`).
- Teste múltiplas imagens, PDF, cancelamento/erro de upload e remoção por editor.
- Confirme que não existem links públicos no Google Drive.
- Teste busca de bairro e alternância Padrão/Satélite.
- Valide limites de Edge Functions, cota do Drive, cota MapTiler e consentimento OAuth.
- Configure backups, retenção e controle de acesso conforme as políticas municipais.

## Referências oficiais

- Supabase Edge Functions: https://supabase.com/docs/guides/functions/auth
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Google Drive resumable uploads: https://developers.google.com/workspace/drive/api/guides/manage-uploads
- MapLibre GL JS + MapTiler Cloud: https://docs.maptiler.com/sdk-js/
- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site


## Ajuste de segurança de novembro de 2026

O frontend foi alterado para usar `maplibre-gl` na faixa `^6.4.1` em lugar do `@maptiler/sdk` que puxava versão vulnerável do MapLibre. Isto mantém mapa de ruas e satélite híbrido usando estilos do MapTiler Cloud, bem como a busca por bairros via a API de geocodificação existente. A versão corrigida é 6.4.1 ou posterior.

Após baixar esta revisão, na raiz do projeto execute `npm.cmd install`, `npm.cmd audit`, `npm.cmd run build`. Execute `npm.cmd audit fix` para vulnerabilidades moderadas transitivas compatíveis, seguido de `npm.cmd audit` e `npm.cmd run build`. Não publique sem verificar as vulnerabilidades remanescentes.
