# BackupDesk 0.7.0 — versão de teste

[Baixar Master Windows x64](https://raw.githubusercontent.com/rochamurilo/backupdesk/main/dist/BackupDesk-Master-0.7.0-x64.exe)

## Criar ou ajustar uma rotina

Na aba Backup, escolha computador, dias, horário e pastas/arquivos de origem. Em **Onde salvar o backup**, escolha Pasta local, HD externo/USB ou Unidade de rede/NAS, selecione a pasta e use **Testar destino e espaço disponível**. O caminho pertence ao computador selecionado, não ao navegador ou necessariamente ao master. No master local, o seletor abre a janela nativa do Windows; nos clients remotos, informe um caminho acessível naquele computador.

Salve e use **Fazer backup agora** para testar. O agendador usa o horário local do computador e executa cada rotina no máximo uma vez por dia agendado; dias perdidos com o computador desligado ainda não são recuperados automaticamente. Rotinas antigas podem ser ajustadas em **Editar**. Elas conservam o armazenamento legado até serem alteradas; não são movidas automaticamente. Atualize os clients para 0.7.0 pelo botão no canto inferior esquerdo do master antes de usar destinos em disco. Agentes antigos não recebem rotinas com esses destinos.

O motor em disco grava versões completas em `DESTINO/BackupDesk/ID-COMPUTADOR/ID-ROTINA/ID-EXECUÇÃO`. Cada versão tem arquivos e manifest.json com hashes SHA-256. Diretórios .partial-* são execuções incompletas e não são apresentados como backups válidos. O catálogo e os status continuam no master; os conteúdos desses backups ficam somente no destino escolhido.

Não apaga versões anteriores. Não há retenção automática, compressão nem deduplicação nesta versão. Verifica espaço para uma cópia completa e acesso de gravação, bloqueia destino dentro da origem e não cria outro destino se o HD/rede estiver indisponível. Usa cópia em fluxo, verifica integridade e detecta alterações no arquivo durante a leitura. Copia arquivos grandes sem o limite antigo de 16 MiB; o armazenamento legado por upload continua limitado.

## Restaurar

Na aba Restauração, selecione computador e versão concluída. Para cópias em disco, escolha uma pasta de recuperação e o arquivo. O agente recupera para `PASTA/BackupDesk-Restaurado/ID-TAREFA`, verifica hashes e não sobrescreve o original. Os backups antigos do armazenamento interno continuam podendo ser baixados pelo navegador. Não é possível recuperar de um disco que não esteja conectado ou de um client que esteja offline.

## Outlook e limitações

No modo normal, PST/OST requer Outlook fechado. No modo VSS experimental, lê um snapshot do volume, com as condições descritas abaixo. Ainda não oferece consistência da aplicação validada nem backup de caixas Microsoft 365. OST é cache e não deve ser considerado o backup principal da caixa postal. Falhas durante cópia preservam versões anteriores.

Use dados de teste. Não há criptografia em repouso, instalador assinado, serviço Windows antes do login, alertas, retomada por blocos, revogação de tokens ou política automática de retenção. A autenticação remota ainda precisa de endurecimento. Não publicar diretamente na internet nem usar como única cópia de dados de produção. Consulte [critérios de validação](BACKUP-VALIDATION.md).

## Instalar e abrir

Instale na mesma pasta para preservar dados e configurações. O instalador encerra com aviso apenas os processos da instalação que impedem a atualização. Pesquise **BackupDesk** no menu Iniciar; o atalho inicia o aplicativo e aguarda o painel antes de abrir o navegador. Também pode usar Win+R: `%LOCALAPPDATA%\BackupDesk\BackupDesk.exe`.

O painel local abre sem senha. Master e client funcionam em segundo plano e iniciam ao entrar na sessão Windows (HKCU Run), não antes do login. Fechar o navegador não encerra o trabalho. O supervisor tenta reiniciar processos que falharem. Logs em `data/startup.log` e `data/launcher.log`; no client, `data/agent.log`. A desinstalação remove a inicialização automática e preserva dados e destinos externos.

No master, **Vincular client** gera o token. Instale o client baixado no próprio master e configure token e URL HTTPS acessível. 127.0.0.1 só atende o mesmo computador. A API escuta no loopback por padrão e acessos pela rede continuam autenticados. O client não instala painel administrativo.

## Desenvolvimento

Node.js 24, sem pacotes externos: `npm start` inicia master e agente local; `npm test` executa testes. `node server.mjs` roda somente a API. `DATA_DIR`, `HOST`, `PORT` e `ADMIN_PASSWORD` (primeira criação) são opcionais. Copiar manifestos/configurações contendo dados pessoais ou tokens para o Git é proibido.

Compilar no Linux: NSIS, curl, unzip, ripgrep e sha256sum; execute `bash windows/build.sh`. O runtime oficial Node.js 24.19.0 é validado por SHA-256; o script gera client e master com client embutido. `MAKENSIS`/`NSISDIR` selecionam compilador extraído localmente. Instaladores e diálogos nativos precisam de validação no Windows real. Testes Linux exercitam cópia/restauração, arquivos grandes, versões, corrupção, migração, destino indisponível, agentes e agendamento. USB e SMB reais não foram validados neste ambiente.


## Rotinas e PST aberto — 0.7.0

As rotinas têm Ativar/Desativar e Excluir. Desativar bloqueia novas execuções agendadas e manuais; não interrompe uma cópia que já iniciou. Excluir é lógico: oculta a rotina, cancela seus backups ainda na fila e preserva arquivos, catálogo e restauração das versões existentes. Ativar novamente permite as próximas execuções elegíveis; não refaz automaticamente uma rotina já concluída no dia.

VSS é **experimental**. Edite uma rotina com destino em disco e marque Usar VSS. Abra **BackupDesk VSS (administrador)** no menu Iniciar e confirme o UAC/reinício do aplicativo. No client, use Client VSS (administrador). O início automático normal continua sem elevação; esta versão não tem serviço privilegiado e o modo VSS precisa ser aberto novamente após entrar em uma nova sessão Windows. O programa não fecha o Outlook.

O helper usa Win32_ShadowCopy com contexto ClientAccessible, sem writers: snapshots locais NTFS por volume, não um conjunto atômico de vários volumes. O agente lê a cópia de sombra, verifica hashes e limpa somente os IDs registrados pela própria instalação, inclusive após falha. Não faz fallback para ler o PST vivo se VSS falhar. Origens UNC/SMB não são suportadas pelo snapshot local; use snapshot no servidor ou uma origem local. Em modo elevado, unidades mapeadas podem não aparecer: prefira destino UNC e permissões corretas.

**Consistência do volume não comprova integridade lógica do PST.** Manifesto, histórico e resultado exibem `vss-crash-consistent-no-writers` e ressalva de recuperação. Outlook não é validado automaticamente e pode exigir reparo do PST. VSS e abertura de um PST recuperado ainda não foram executados em Windows real neste ambiente Linux. Mantenha cópia alternativa e valide uma restauração no Outlook antes de confiar em PST aberto. As informações da seção anterior sobre ausência de VSS aplicam-se ao modo normal; o modo experimental não substitui um serviço VSS de produção.

A exclusão/desativação foi testada com agente real e restauração preservada. Testes VSS simulam criação, mapeamento, falhas e limpeza; não estabelecem funcionamento nativo. Se a atualização não puder parar um processo elevado, execute o atualizador com administrador, escolhendo a mesma pasta.

O modo master elevado força loopback, bloqueia o login comum e exige autorização temporária passada pelo inicializador ao navegador. Não é configurado como tarefa elevada permanente. Proteção da instalação, assinatura e serviço privilegiado ainda são requisitos para produção.

A versão 0.7.0 mostra o andamento no topo: fila, preparação, VSS, cópia, verificação e resultado. O percentual mede os bytes processados na cópia e verificação; a conclusão só aparece após finalizar. Durante a leitura das pastas e criação do VSS a barra é indeterminada. A fila aguarda um agente conectado. O estado é mantido ao atualizar a página.
