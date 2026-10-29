# BackupDesk 0.4.0 — versão de teste

[Baixar Master Windows x64](https://raw.githubusercontent.com/rochamurilo/backupdesk/main/dist/BackupDesk-Master-0.4.0-x64.exe)

## Usar

Instale o Master na mesma pasta da versão anterior. O instalador preserva banco, credenciais, rotinas e backups. Se necessário, solicita encerrar os processos da instalação para atualizar. O master abre direto no painel local sem senha, cadastra o computador local e inicia o agente automaticamente.

- **Visão geral:** equipamentos, resultados e calendário.
- **Backup:** computador, arquivos/pastas de origem, frequência diária/semanal/mensal e horário.
- **Restauração:** selecione computador, versão concluída e arquivo para recuperar pelo navegador. O navegador escolhe a pasta de download; esta versão não sobrescreve automaticamente a origem.

Não há botão de encerrar. Fechar o navegador mantém o aplicativo em segundo plano. O instalador registra inicialização automática do master e do client ao entrar na sessão do Windows (HKCU Run), sem abrir navegador no login. Não é um serviço antes do login; o usuário precisa ter iniciado sessão. Isso preserva permissões de unidades mapeadas. Computador desligado ou em suspensão não executa backups. O sistema operacional pode encerrar o aplicativo; o supervisor reinicia o servidor/agente após falhas enquanto estiver ativo.

## Clients

Baixe o instalador **Client** pelo botão no canto inferior esquerdo do master (somente perfil master). No diálogo **Vincular client**, cadastre o equipamento e obtenha o token. Configure URL HTTPS do master e token no client; ele inicia em segundo plano e nas próximas sessões Windows. O client não instala painel administrativo. Credenciais de usuários client são gerenciadas no mesmo diálogo, fora da tela principal. Cada usuário/agent só acessa seus equipamentos autorizados. O instalador não contém tokens.

O endereço 127.0.0.1 é local; computadores diferentes exigem uma URL HTTPS acessível, ainda não configurada pelo instalador. A API escuta somente na interface local por padrão. Ao publicar na rede, a autenticação continua obrigatória; a sessão automática exige master vinculado ao loopback e requisição da mesma origem.

## Arquivos e agendamento

O seletor consulta o computador do agente, incluindo discos locais, unidades mapeadas e caminhos UNC (`\\servidor\compartilhamento`) acessíveis ao usuário. Credenciais de rede devem estar configuradas no Windows. Permite múltiplas origens e limita a listagem a 1.000 entradas. Links simbólicos são ignorados. Origens múltiplas usam namespaces numerados para evitar colisões.

Semanais executam nas segundas; mensais no dia 1. O agente verifica horários a cada minuto e não recupera dias perdidos. Rotinas antigas de pasta única continuam válidas.

## Desenvolvimento e compilação

Node.js 24, sem dependências de terceiros:

```sh
npm start
npm test
```

`npm start` inicia o supervisor do master e agente local. `node server.mjs` executa somente a API. `DATA_DIR`, `HOST`, `PORT`, `ADMIN_PASSWORD` (primeira criação de usuário) são opcionais. `node master.mjs --background` não abre navegador. Logs em `data/startup.log`; no client, `data/agent.log`. O banco SQLite e blobs SHA-256 ficam em `data/`.

Para compilar no Linux: NSIS, curl, unzip, ripgrep, sha256sum e `bash windows/build.sh`. O script verifica SHA-256 do Node.js 24.19.0 oficial, compila os launchers GUI, depois client e master com client embutido. `MAKENSIS`/`NSISDIR` podem selecionar compilador extraído localmente. Atualização e desinstalação usam Restart Manager para encerrar somente processos que utilizam o executável da instalação. Desinstalar remove HKCU Run e preserva os dados.

Os testes exercitam backup/restauração, isolamento, seleção de arquivos, bootstrap, sessões locais, execução contínua e reinício do servidor. Fluxos de interface são conferidos em Chromium no Linux. Instaladores, registro de início automático e unidades de rede precisam de validação no Windows real.

## Limites

Use dados de teste. Arquivo individual até 16 MiB; sem VSS/Outlook aberto, serviço Windows antes do login, retenção/expurgo, criptografia em repouso, transferências por blocos/retomada, alertas de ausência ou revogação de tokens. Arquivos alterados durante leitura causam falha. Sessões ficam na memória. Login remoto precisa de melhorias antes de produção (salt aleatório, expiração e limitação de tentativas). Instaladores sem assinatura digital. Não usar como única cópia de dados nem publicar diretamente na internet nesta versão.
