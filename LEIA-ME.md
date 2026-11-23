# Agenda Vereadora Dalila — guia de configuração

App de agenda compartilhada (vereadora + assessoras), instalável no iPhone, com:
calendário mensal, eventos com tipo, local (abre no Mapas), contato (WhatsApp/ligar),
quem acompanha, compartilhamento da agenda do dia/semana/mês pelo WhatsApp,
login individual e notificações (1 h antes + aviso quando alguém cria/altera/exclui evento).

Enquanto o Firebase não estiver configurado, o app abre em **modo demonstração**
(dados só no aparelho), útil para conhecer as telas.

---

## Parte 1 — Firebase (banco de dados e login) · ~15 min

1. Acesse <https://console.firebase.google.com> com uma conta Google e clique em **Criar projeto**
   (ex.: `agenda-dalila`). O Google Analytics pode ficar desativado. Plano gratuito (Spark).
2. **Registrar o app web:** na tela do projeto clique no ícone **`</>`** (Web), dê o nome
   "Agenda" e clique em *Registrar app*. Vai aparecer um bloco `firebaseConfig = { apiKey: ..., ... }`.
   Copie esses valores para `js/config.js` (ou me envie que eu preencho).
3. **Login:** menu *Criação > Authentication > Vamos começar > E-mail/senha* → ativar → Salvar.
   Na aba **Usuários**, clique em **Adicionar usuário** e crie uma conta para cada pessoa
   (vereadora e assessoras) com e-mail e uma senha provisória.
4. **Banco de dados:** *Criação > Firestore Database > Criar banco de dados* →
   local `southamerica-east1 (São Paulo)` → **modo de produção**.
   Na aba **Regras**, apague tudo, cole o conteúdo do arquivo `firestore.rules`,
   **troque os e-mails de exemplo pelos e-mails reais da equipe** e clique em **Publicar**.
   > Guarde os e-mails reais só no Console — no GitHub o arquivo pode ficar com os exemplos.
5. **Notificações:** *⚙ Configurações do projeto > Cloud Messaging > Configuração da Web >
   Certificados push da Web > Gerar par de chaves*. Copie a chave para `vapidKey` em `js/config.js`.

## Parte 2 — Publicar o app (GitHub Pages, gratuito) · ~10 min

1. Crie uma conta em <https://github.com> e um repositório **público** chamado `agenda-dalila`.
2. Na página do repositório: **Add file > Upload files** e arraste **todo o conteúdo** desta pasta
   (inclusive a pasta `.github`, as pastas `css`, `js`, `icons`, `notifier`). Clique em *Commit changes*.
3. *Settings > Pages*: em **Source** escolha *Deploy from a branch*, branch `main`, pasta `/ (root)` → Save.
   Em 1–2 minutos o app estará em `https://SEU-USUARIO.github.io/agenda-dalila/`.
4. Volte ao Firebase: *Authentication > Configurações > Domínios autorizados > Adicionar domínio* →
   `SEU-USUARIO.github.io`.

## Parte 3 — Robô de notificações (GitHub Actions, gratuito) · ~5 min

1. Firebase: *⚙ Configurações do projeto > Contas de serviço > Gerar nova chave privada*.
   Baixa um arquivo `.json` — **é uma senha de administrador: não envie para ninguém nem suba no repositório.**
2. GitHub, no repositório: *Settings > Secrets and variables > Actions*:
   - aba **Secrets** → *New repository secret* → nome `FIREBASE_SERVICE_ACCOUNT`, valor: todo o conteúdo do `.json`.
   - aba **Variables** → *New repository variable* → nome `APP_URL`, valor: o endereço do app
     (ex.: `https://SEU-USUARIO.github.io/agenda-dalila/`).
3. Aba **Actions** → *Notificações da agenda* → **Run workflow** para testar. Depois disso ele roda
   sozinho a cada ~10 minutos.

> O GitHub pode atrasar alguns minutos as execuções agendadas, então os lembretes chegam
> entre ~50 e 70 min antes, e os avisos de "novo evento" em até ~10–15 min.
> Se o repositório ficar 60 dias sem nenhuma alteração, o GitHub pausa o robô e manda um
> e-mail com um botão para reativar — basta clicar.

## Parte 4 — Instalar no iPhone (cada pessoa)

1. Abra o endereço do app no **Safari**.
2. Toque em **Compartilhar** (quadrado com seta) → **Adicionar à Tela de Início** → **Adicionar**.
3. Abra pelo ícone novo, entre com e-mail e senha.
4. Toque no ícone de pessoa (canto superior direito) → coloque seu nome → **Ativar notificações**.
   (Requer iOS 16.4 ou mais recente.)

No Android/computador também funciona pelo Chrome (menu ⋮ → *Instalar app*).

## Adicionar alguém novo à equipe

1. Firebase > Authentication > **Adicionar usuário**.
2. Firestore > Regras → inclua o e-mail na lista → **Publicar**.

## Estrutura dos arquivos

| Arquivo | Função |
|---|---|
| `index.html`, `css/style.css`, `js/app.js` | Telas do app |
| `js/store.js` | Conexão com o Firebase (ou modo demonstração) |
| `js/config.js` | **Suas chaves do Firebase** |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalação no celular, offline e notificações |
| `firestore.rules` | Quem pode acessar os dados |
| `notifier/`, `.github/workflows/` | Robô que envia as notificações |

## Testar no computador

Na pasta do projeto: `python -m http.server 8791` e abra <http://localhost:8791>.
