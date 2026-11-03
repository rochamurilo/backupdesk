# BackupDesk 0.5.0 — versão de teste

[Baixar Master Windows x64](https://raw.githubusercontent.com/rochamurilo/backupdesk/main/dist/BackupDesk-Master-0.5.0-x64.exe)

## Criar ou ajustar uma rotina

Na aba Backup, escolha computador, dias, horário e pastas/arquivos de origem. Em **Onde salvar o backup**, escolha Pasta local, HD externo/USB ou Unidade de rede/NAS, selecione a pasta e use **Testar destino e espaço disponível**. O caminho pertence ao computador selecionado, não ao navegador ou necessariamente ao master. No master local, o seletor abre a janela nativa do Windows; nos clients remotos, informe um caminho acessível naquele computador.

Salve e use **Fazer backup agora** para testar. O agendador usa o horário local do computador e executa cada rotina no máximo uma vez por dia agendado; dias perdidos com o computador desligado ainda não são recuperados automaticamente. Rotinas antigas podem ser ajustadas em **Editar**. Elas conservam o armazenamento legado até serem alteradas; não são movidas automaticamente. Atualize os clients para 0.5.0 pelo botão no canto inferior esquerdo do master antes de usar destinos em disco. Agentes antigos não recebem rotinas com esses destinos.

O motor em disco grava versões completas em `DESTINO/BackupDesk/ID-COMPUTADOR/ID-ROTINA/ID-EXECUÇÃO`. Cada versão tem arquivos e manifest.json com hashes SHA-256. Diretórios .partial-* são execuções incompletas e não são apresentados como backups válidos. O catálogo e os status continuam no master; os conteúdos desses backups ficam somente no destino escolhido.

Não apaga versões anteriores. Não há retenção automática, compressão nem deduplicação nesta versão. Verifica espaço para uma cópia completa e acesso de gravação, bloqueia destino dentro da origem e não cria outro destino se o HD/rede estiver indisponível. Usa cópia em fluxo, verifica integridade e detecta alterações no arquivo durante a leitura. Copia arquivos grandes sem o limite antigo de 16 MiB; o armazenamento legado por upload continua limitado.

## Restaurar

Na aba Restauração, selecione computador e versão concluída. Para cópias em disco, escolha uma pasta de recuperação e o arquivo. O agente recupera para `PASTA/BackupDesk-Restaurado/ID-TAREFA`, verifica hashes e não sobrescreve o original. Os backups antigos do armazenamento interno continuam podendo ser baixados pelo navegador. Não é possível recuperar de um disco que não esteja conectado ou de um client que esteja offline.

## Outlook e limitações

PST/OST requer Outlook fechado. O agente Windows verifica OUTLOOK.EXE antes de copiar esses arquivos; se estiver aberto, falha com orientação em vez de registrar sucesso. Ainda não implementa VSS, backup consistente de aplicações abertas nem backup de caixas Microsoft 365. OST é cache e não deve ser considerado o backup principal da caixa postal. Falhas durante cópia preservam versões anteriores.

Use dados de teste. Não há criptografia em repouso, instalador assinado, serviço Windows antes do login, alertas, retomada por blocos, revogação de tokens ou política automática de retenção. A autenticação remota ainda precisa de endurecimento. Não publicar diretamente na internet nem usar como única cópia de dados de produção. Consulte [critérios de validação](BACKUP-VALIDATION.md).

## Instalar e abrir

Instale na mesma pasta para preservar dados e configurações. O instalador encerra com aviso apenas os processos da instalação que impedem a atualização. Pesquise **BackupDesk** no menu Iniciar; o atalho inicia o aplicativo e aguarda o painel antes de abrir o navegador. Também pode usar Win+R: `%LOCALAPPDATA%\BackupDesk\BackupDesk.exe`.

O painel local abre sem senha. Master e client funcionam em segundo plano e iniciam ao entrar na sessão Windows (HKCU Run), não antes do login. Fechar o navegador não encerra o trabalho. O supervisor tenta reiniciar processos que falharem. Logs em `data/startup.log` e `data/launcher.log`; no client, `data/agent.log`. A desinstalação remove a inicialização automática e preserva dados e destinos externos.

No master, **Vincular client** gera o token. Instale o client baixado no próprio master e configure token e URL HTTPS acessível. 127.0.0.1 só atende o mesmo computador. A API escuta no loopback por padrão e acessos pela rede continuam autenticados. O client não instala painel administrativo.

## Desenvolvimento

Node.js 24, sem pacotes externos: `npm start` inicia master e agente local; `npm test` executa testes. `node server.mjs` roda somente a API. `DATA_DIR`, `HOST`, `PORT` e `ADMIN_PASSWORD` (primeira criação) são opcionais. Copiar manifestos/configurações contendo dados pessoais ou tokens para o Git é proibido.

Compilar no Linux: NSIS, curl, unzip, ripgrep e sha256sum; execute `bash windows/build.sh`. O runtime oficial Node.js 24.19.0 é validado por SHA-256; o script gera client e master com client embutido. `MAKENSIS`/`NSISDIR` selecionam compilador extraído localmente. Instaladores e diálogos nativos precisam de validação no Windows real. Testes Linux exercitam cópia/restauração, arquivos grandes, versões, corrupção, migração, destino indisponível, agentes e agendamento. USB e SMB reais não foram validados neste ambiente.
