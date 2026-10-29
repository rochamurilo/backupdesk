# BackupDesk — versão de teste 0.3.1

[Baixar BackupDesk Master para Windows x64](https://raw.githubusercontent.com/rochamurilo/backupdesk/main/dist/BackupDesk-Master-0.3.1-x64.exe)

## Master

Instale em Windows 10/11 x64. Ao instalar, o programa prepara o banco e cadastra automaticamente o próprio computador, sem duplicá-lo nas próximas inicializações. Ao concluir, deixe marcada a opção **Abrir master e criar rotinas**. O atalho **BackupDesk > Painel local** abre o navegador quando o servidor está disponível e inicia o agente local automaticamente.

Entre com `admin` e a senha gerada em `%LOCALAPPDATA%\BackupDesk\data\initial-admin.txt`. Em Nova rotina, o computador local já estará disponível. Use Selecionar arquivos e pastas, escolha as origens e salve. Não precisa configurar token nem abrir outro agente no master. O painel e o agente local funcionam enquanto a janela do master estiver aberta.

Para atualizar de 0.1/0.2, feche painel e agentes anteriores, instale na mesma pasta e reabra. Use Ctrl+F5 no navegador. Cadastros, tokens, rotinas e backups são preservados.

## Client

No canto inferior esquerdo do painel master há **Baixar client Windows**. O botão só aparece para o perfil master; a API também bloqueia o download para clientes e usuários não autenticados. O master inclui o instalador client, permitindo baixar pelo próprio painel sem acesso ao GitHub. O binário client não é publicado separadamente no repositório.

O client instala em `%LOCALAPPDATA%\BackupDeskClient`, sem servidor, painel administrativo ou banco local. No master, cadastre o equipamento e associe-o ao usuário client desejado; informe a URL do master e o token no assistente do client. Ao salvar, o agente inicia. Ele só recebe as rotinas do equipamento vinculado ao seu token. Usuários client acessam o painel central com suas credenciais e só veem seus equipamentos. O instalador não inclui contas ou tokens.

A URL local `127.0.0.1` só funciona no mesmo computador. Para computadores diferentes, o servidor precisa ser acessível por uma URL HTTPS configurada. Hospedagem e HTTPS ainda não são configurados pelo instalador. O servidor escuta somente na interface local por padrão. Clientes ainda exigem a janela do agente aberta.

O controle de download exige login master. Como qualquer software distribuído, uma cópia do instalador pode ser compartilhada por quem o baixar; isso não concede acesso administrativo ao servidor.

## Origens e agendamento

Selecione múltiplos arquivos e pastas no computador do agente. O seletor consulta o agente autorizado, não o disco do navegador ou do servidor central. Lista unidades Windows e permite informar caminhos UNC (`\\servidor\compartilhamento`) e unidades mapeadas acessíveis ao usuário do agente. Credenciais de rede devem estar configuradas no Windows. Cada listagem tem limite de 1.000 entradas. Links simbólicos são ignorados.

As rotinas são diárias, semanais às segundas e mensais no dia 1, após o horário local escolhido. O agente verifica horários a cada minuto; o estado local evita repetir a rotina no mesmo dia. Não recupera dias perdidos. Origens múltiplas são armazenadas em namespaces numerados para evitar colisões. Rotinas antigas de pasta única continuam válidas.

## Desenvolvimento

Node.js 24, sem dependências externas:

```sh
npm start
npm test
```

`npm start` inicia o master com agente local automático. `node server.mjs` executa somente a API, sem preparar um equipamento local. `DATA_DIR`, `HOST`, `PORT` e `ADMIN_PASSWORD` (somente primeira criação de usuário) são opcionais. O banco é SQLite e os arquivos são objetos SHA-256 em `data/blobs`. Credenciais nunca devem ser adicionadas ao Git.

Para um agente de desenvolvimento separado, mantenha `agent.mjs` e `filesystem.mjs` juntos, defina `BACKUPDESK_URL`/`BACKUPDESK_TOKEN` no ambiente e execute `node agent.mjs`. Para envio único: `node agent.mjs --once /caminho/absoluto`. `BACKUPDESK_AGENT_STATE` configura o arquivo de estado.

Testes cobrem autenticação, isolamento client, envio/restauração, seleção múltipla, navegação via agente e bootstrap automático/idempotente do master. O seletor também foi validado em Chromium no Linux. Instalação e acesso a unidades de rede precisam de validação no Windows real.

## Compilar instaladores

Em Linux: NSIS, curl, unzip, ripgrep e sha256sum. Execute `bash windows/build.sh`. O script baixa Node.js 24.19.0 oficial e verifica SHA-256. Opcionalmente defina `MAKENSIS` e `NSISDIR` para um compilador local. Compila primeiro o client em `windows/build`, depois o master com o client embutido. O arquivo de checksum do master fica em `dist/SHA256SUMS.txt`.

## Limites

Use dados de teste. Arquivo individual de até 16 MiB; sem VSS/Outlook, serviço Windows, auto-início no boot, retenção/expurgo, criptografia em repouso, retomada/blocos, alertas de ausência ou revogação de tokens. Arquivos alterados durante a leitura causam falha. Sessões ficam na memória e somem ao reiniciar. Login usa scrypt com salt fixo; precisa de salt aleatório, limitação de tentativas e expiração antes de produção. Sem assinatura digital. Não publicar diretamente na internet nem usar os 4,35 TB planejados antes de implementar essas etapas. Desinstalar preserva dados e configurações locais.


## Atualização segura (0.3.1)

Antes de substituir arquivos, o instalador usa o Restart Manager do Windows para identificar processos que usam o `node.exe` da pasta escolhida. Se o BackupDesk estiver aberto, avisa que rotinas em andamento poderão ser interrompidas e solicita confirmação para encerrar esses processos. Não encerra processos Node.js por nome nem afeta outras instalações. Cancelar não substitui arquivos. Se o Windows negar o encerramento ou o executável continuar bloqueado/sem permissão de gravação, a instalação para antes de copiar; permite tentar novamente após fechar as janelas. A desinstalação usa a mesma verificação.

Ao reiniciar o master, execuções locais que ficaram em andamento por um encerramento anterior são marcadas como falha/interrompidas. Execuções de computadores remotos não são alteradas. Banco, credenciais, rotinas e arquivos de backup são preservados. O fluxo nativo de fechamento pelo Restart Manager foi compilado em Linux e ainda exige teste em Windows real; não é possível garantir que nenhum antivírus ou política de permissões bloqueará arquivos.
