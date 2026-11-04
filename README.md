# BackupDesk 0.8.2 — versão de teste

[Baixar Master Windows x64](https://raw.githubusercontent.com/rochamurilo/backupdesk/main/dist/BackupDesk-Master-0.8.2-x64.exe)

## Criar ou ajustar uma rotina

Na aba Backup, escolha computador, dias, horário e pastas/arquivos de origem. Em **Onde salvar o backup**, escolha Pasta local, HD externo/USB ou Unidade de rede/NAS, selecione a pasta e use **Testar destino e espaço disponível**. O caminho pertence ao computador selecionado, não ao navegador ou necessariamente ao master. No master local, o seletor abre a janela nativa do Windows; nos clients remotos, informe um caminho acessível naquele computador.

Salve e use **Fazer backup agora** para testar. O agendador usa o horário local do computador e executa cada rotina no máximo uma vez por dia agendado; dias perdidos com o computador desligado ainda não são recuperados automaticamente. Rotinas antigas podem ser ajustadas em **Editar**. Elas conservam o armazenamento legado até serem alteradas; não são movidas automaticamente. Atualize os clients para 0.8.2 pelo botão no canto inferior esquerdo do master antes de usar destinos em disco. Agentes antigos não recebem rotinas com esses destinos.

O motor em disco grava versões completas em `DESTINO/BackupDesk/ID-COMPUTADOR/ID-ROTINA/ID-EXECUÇÃO`. Cada versão tem arquivos e manifest.json com hashes SHA-256. Diretórios .partial-* são execuções incompletas e não são apresentados como backups válidos. O catálogo e os status continuam no master; os conteúdos desses backups ficam somente no destino escolhido.

Não apaga versões anteriores. Não há retenção automática, compressão nem deduplicação nesta versão. Verifica espaço para uma cópia completa e acesso de gravação, bloqueia destino dentro da origem e não cria outro destino se o HD/rede estiver indisponível. Usa cópia em fluxo, verifica integridade e detecta alterações no arquivo durante a leitura. Copia arquivos grandes sem o limite antigo de 16 MiB; o armazenamento legado por upload continua limitado.

## Restaurar

Na aba Restauração, selecione computador e versão concluída. Para cópias em disco, escolha uma pasta de recuperação e o arquivo. O agente recupera para `PASTA/BackupDesk-Restaurado/ID-TAREFA`, verifica hashes e não sobrescreve o original. Os backups antigos do armazenamento interno continuam podendo ser baixados pelo navegador. Não é possível recuperar de um disco que não esteja conectado ou de um client que esteja offline.

## Outlook e limitações

No modo normal, PST/OST requer Outlook fechado. No modo VSS experimental, lê um snapshot do volume, com as condições descritas abaixo. Ainda não oferece consistência da aplicação validada nem backup de caixas Microsoft 365. OST é cache e não deve ser considerado o backup principal da caixa postal. Falhas durante cópia preservam versões anteriores.

Use dados de teste. Não há criptografia em repouso, instalador assinado, serviço Windows antes do login, alertas, retomada por blocos, revogação de tokens ou política automática de retenção. A autenticação remota ainda precisa de endurecimento. Não publicar diretamente na internet nem usar como única cópia de dados de produção. Consulte [critérios de validação](BACKUP-VALIDATION.md).

## Instalar e abrir

Instale na mesma pasta para preservar dados e configurações. O instalador pede sua autorização Windows uma vez antes da atualização e encerra automaticamente apenas os processos que usam o node.exe daquela pasta, inclusive versões elevadas. Supervisores são encerrados antes dos agentes; nenhum arquivo do aplicativo é substituído se a liberação falhar. Um backup em execução pode ser interrompido; versões concluídas e cadastros são preservados. Pesquise **BackupDesk** no menu Iniciar; o atalho inicia o aplicativo e aguarda o painel antes de abrir o navegador. Também pode usar Win+R: `%LOCALAPPDATA%\BackupDesk\BackupDesk.exe`.

O painel local abre sem senha. Master e client funcionam em segundo plano e iniciam ao entrar na sessão Windows por tarefa de logon do usuário normal, com HKCU Run como alternativa. O componente VSS inicia no boot; painel e agente iniciam ao entrar no Windows, sem abrir o navegador. Fechar o navegador não encerra o trabalho. O supervisor tenta reiniciar processos que falharem. Logs em `data/startup.log` e `data/launcher.log`; no client, `data/agent.log`. A desinstalação remove as tarefas e a entrada Run da própria instalação e preserva os dados e destinos externos.

No master, **Vincular client** gera o token. Instale o client baixado no próprio master e configure token e URL HTTPS acessível. 127.0.0.1 só atende o mesmo computador. A API escuta no loopback por padrão e acessos pela rede continuam autenticados. O client não instala painel administrativo.

## Desenvolvimento

Node.js 24, sem pacotes externos: `npm start` inicia master e agente local; `npm test` executa testes. `node server.mjs` roda somente a API. `DATA_DIR`, `HOST`, `PORT` e `ADMIN_PASSWORD` (primeira criação) são opcionais. Copiar manifestos/configurações contendo dados pessoais ou tokens para o Git é proibido.

Compilar no Linux: NSIS, curl, unzip, ripgrep e sha256sum; execute `bash windows/build.sh`. O runtime oficial Node.js 24.19.0 é validado por SHA-256; o script gera client e master com client embutido. `MAKENSIS`/`NSISDIR` selecionam compilador extraído localmente. Instaladores e diálogos nativos precisam de validação no Windows real. Testes Linux exercitam cópia/restauração, arquivos grandes, versões, corrupção, migração, destino indisponível, agentes e agendamento. USB e SMB reais não foram validados neste ambiente.


## Rotinas e PST aberto — 0.8.1

As rotinas têm Ativar/Desativar e Excluir. Desativar bloqueia novas execuções agendadas e manuais; não interrompe uma cópia que já iniciou. Excluir é lógico: oculta a rotina, cancela seus backups ainda na fila e preserva arquivos, catálogo e restauração das versões existentes. Ativar novamente permite as próximas execuções elegíveis; não refaz automaticamente uma rotina já concluída no dia.

VSS é **experimental**. Marque Usar VSS e salve a rotina. O componente automático é instalado com autorização UAC uma vez por instalação/atualização. Ele inicia com o Windows e atende os pedidos de snapshot sem elevar ou reiniciar o painel e o agente. Não é necessário abrir modo administrador para cada backup. O programa não fecha o Outlook. Os atalhos antigos de modo administrador são removidos na atualização.

O componente é uma tarefa de inicialização do Agendador de Tarefas, executada como SYSTEM; não é um serviço que execute todo o aplicativo como administrador. Seu código fica em `Program Files/BackupDesk VSS/master` ou `client`, com gravação restrita a Administradores e SYSTEM. O pipe local aceita somente o SID cadastrado na instalação. O cliente verifica que o pipe pertence a SYSTEM. O protocolo permite somente consultar disponibilidade, criar snapshot de volume local NTFS e remover snapshots registrados pela própria instalação. Não aceita comandos, scripts, caminhos de ledger nem leitura arbitrária de arquivos como SYSTEM. O painel e a cópia para destinos locais/USB/rede continuam no usuário normal. A desinstalação remove a tarefa daquele usuário/produto e seus snapshots próprios; scripts compartilhados protegidos podem permanecer para outros usuários.

O helper usa Win32_ShadowCopy com contexto ClientAccessible, sem writers: snapshots por volume, não um conjunto atômico de vários volumes. Não faz fallback para ler o PST vivo se VSS falhar. Origens UNC/SMB não suportam snapshot local; use origem local ou snapshot no servidor.

**Consistência do volume não comprova integridade lógica do PST.** Manifesto, histórico e resultado exibem `vss-crash-consistent-no-writers`. Valide um PST restaurado no Outlook antes de confiar no backup de um arquivo aberto; o Outlook não é validado automaticamente. O teste Windows automatizado usa um arquivo bloqueado de teste, não um PST real com Outlook.

O painel mostra a disponibilidade do componente automático na aba Backup. Se indisponível, execute o instalador e autorize o componente. Nenhum botão no painel solicita elevação ou reinício. Atualize também os clients para obter esse fluxo.

O andamento aparece no topo: fila, preparação, VSS, cópia, verificação e resultado. O percentual mede os bytes processados na cópia e verificação; a conclusão só aparece após finalizar. Leitura das pastas e criação VSS usam barra indeterminada.

Cada rotina tem uma tentativa automática por dia elegível, mesmo se falhar ou o agente reiniciar. Outras rotinas continuam sendo processadas. Após corrigir uma falha, use Fazer backup agora para nova tentativa manual. Falhas anteriores permanecem no histórico.

A validação nativa em Windows é executada pelo workflow `Windows VSS component`: tarefa SYSTEM, comunicação autenticada, arquivo bloqueado, motor de backup e limpeza. O resultado do workflow deve ser consultado antes de considerar essa parte validada. Ele não substitui o teste de recuperação do PST real.

Validação nativa concluída: [Windows VSS component — execução 41705150814](https://github.com/rochamurilo/backupdesk/actions/runs/41705150814). Uma conta comum copiou um arquivo bloqueado usando o componente SYSTEM, verificou a cópia e testou isolamento/limpeza. Não valida integridade lógica de PST real com Outlook.

0.8.1: encerramento para atualização é executado pelo helper do instalador elevado, por caminho exato do executável e com conferência no handle do processo. Não depende de RmShutdown e não encerra outros Node.js. Uma trava temporária bloqueia reinícios durante a troca dos arquivos e expira em 15 minutos se o instalador for interrompido. Ao concluir, o aplicativo é iniciado em segundo plano mesmo sem abrir o navegador.

Validação 0.8.1: 29 testes locais passaram, incluindo bloqueio de reinício durante atualização e expiração da trava. O código PowerShell e o trecho C# foram compilados/verificados. O teste nativo de encerramento e registro da inicialização está no [workflow Windows](https://github.com/rochamurilo/backupdesk/actions/runs/41864928672); na publicação ele ainda aguardava executor, portanto esse novo fluxo não deve ser considerado validado nativamente até a conclusão desse teste.

## Salvar rotinas e avisos — 0.8.2
Depois de salvar, o formulário continua em Editar rotina e o botão passa a Salvar alterações. Cliques repetidos e reenvio da mesma configuração não criam novas cópias. Para cadastrar outra rotina, use Nova rotina; os campos são limpos. A ação Remover cópias idênticas mantém a rotina mais antiga, cancela as tarefas duplicadas ainda na fila e preserva os backups e o histórico. Rotinas com parâmetros ou situação diferentes não são removidas.

Somente o andamento ativo permanece fixado no topo. Uma falha de cópia comum, quando a rotina já foi alterada para VSS, aparece como tentativa anterior, recolhida e sem encobrir o formulário. Fechar aviso oculta esse resultado na sessão do navegador; novas execuções e novas falhas continuam visíveis. Histórico e contagem de falhas não são apagados. Alterar a configuração não comprova que um backup foi feito: execute novamente e valide a restauração.

Verificação de interface: `npm run test:browser` (Chromium instalado; CHROMIUM_BIN permite escolher o executável).

Validação 0.8.2: 30 testes locais e a checagem Chromium passaram. O [workflow Windows 41870736621](https://github.com/rochamurilo/backupdesk/actions/runs/41870736621) também passou, incluindo o encerramento por caminho exato, preservação de outros Node.js, tarefa de logon no usuário normal e o componente VSS. A falha anterior do teste de inicialização foi corrigida comparando os caminhos após a mesma normalização usada no registro da tarefa.
