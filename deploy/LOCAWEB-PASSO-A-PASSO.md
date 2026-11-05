# Locaweb: painel web com backups locais ou em rede

Este roteiro usa BackupDesk 0.16.0 e Ubuntu Server 24.04 LTS. O servidor do escritório não é necessário. A instalação na Locaweb recebe status, histórico, catálogo e relatórios; os arquivos criptografados são gravados pelo computador na pasta local, HD externo ou compartilhamento escolhido. Não existe transferência do conteúdo para o VPS nesse modo.

## 1. Contratar

Acesse https://www.locaweb.com.br/servidor-vps/ e escolha um VPS Linux equivalente a **4 vCPU, 8 GB de RAM e 80–100 GB SSD**, com IPv4 público e acesso administrativo por SSH. Para o sistema, escolha Ubuntu Server 24.04 LTS; se essa imagem não estiver disponível, peça ao suporte uma opção compatível com Docker e adapte a instalação do Docker ao sistema oferecido. Não selecione hospedagem compartilhada de sites.

Confirme na contratação: recursos, franquia de tráfego, IPv4 público, snapshots e política de backup do VPS. Os preços e nomes dos planos variam; este guia indica capacidade, não uma cotação consultada. O disco do VPS armazena banco, catálogos e logs, que crescem com a quantidade de arquivos e execuções. Não contém os terabytes dos backups dos clientes.

Contrate um domínio ou use um que já possua. Exemplo deste roteiro: `painel.suaempresa.com.br`.

## 2. Configurar DNS e portas

No painel DNS responsável pelo domínio, crie:

| Tipo | Nome | Valor |
| --- | --- | --- |
| A | painel | IPv4 público do VPS |

O nome do campo pode variar; alguns painéis pedem o domínio completo. Não crie um registro AAAA sem configurar também o IPv6 do servidor. Aguarde o DNS resolver para o IPv4 correto. No Windows, pode conferir com `nslookup painel.suaempresa.com.br`.

No firewall da Locaweb e em eventual firewall do Ubuntu, permita TCP 80 e 443 para o painel. Permita SSH/TCP 22 somente a partir do seu IP administrativo, quando possível. Não publique 3000, SMB/445 ou o banco de dados. Se configurar UFW remotamente, permita primeiro seu acesso SSH para não perder a conexão.

## 3. Acessar e preparar o VPS

Use o console do provedor ou SSH com a conta administrativa fornecida. Os comandos seguintes são executados **no VPS**, uma vez; não são comandos para instalar cada client Windows.

```bash
ssh usuario-administrativo@IP_DO_VPS
```

Em Ubuntu 24.04:

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git ca-certificates nano
sudo systemctl enable --now docker
sudo docker compose version
```

Se a imagem do provedor não disponibilizar `docker-compose-v2`, siga a instalação oficial para Ubuntu: https://docs.docker.com/engine/install/ubuntu/ . O requisito é que `sudo docker compose version` funcione; não use comandos de Debian/Windows nesta receita Ubuntu.

Baixe a aplicação:

```bash
sudo git clone --depth 1 https://github.com/rochamurilo/backupdesk.git /opt/backupdesk
cd /opt/backupdesk
sudo cp deploy/central.env.example deploy/central.env
sudo chmod 600 deploy/central.env
sudo nano deploy/central.env
```

Preencha as três linhas, substituindo o exemplo e escolhendo duas senhas longas, diferentes, com pelo menos 20 caracteres. Para evitar regras de escape de arquivos `.env`, prefira senhas aleatórias com letras, números e hífen, sem espaços, `#` ou `$`.

```dotenv
CONTROL_DOMAIN=painel.suaempresa.com.br
ADMIN_PASSWORD=SUA-SENHA-LONGA-DO-MASTER
KEY_ENCRYPTION_PASSWORD=OUTRA-SENHA-LONGA-PARA-A-CHAVE
```

`ADMIN_PASSWORD` cria a conta `admin` na primeira inicialização. `KEY_ENCRYPTION_PASSWORD` protege a chave privada no servidor; preserve essa senha e o volume de dados nas atualizações. Não envie esse arquivo a terceiros nem o publique no GitHub.

## 4. Iniciar somente o painel

```bash
cd /opt/backupdesk
sudo docker compose --env-file deploy/central.env -f deploy/compose.central.yml up -d --build
sudo docker compose --env-file deploy/central.env -f deploy/compose.central.yml ps
```

O Dockerfile inclui o client Windows do instalador publicado. Caddy solicita e renova HTTPS automaticamente; DNS e portas 80/443 devem estar acessíveis para a emissão inicial. O domínio configurado também é incorporado automaticamente nos clients baixados pelo painel.

Abra no navegador:

```text
https://painel.suaempresa.com.br
```

Entre com **admin** e a senha de `ADMIN_PASSWORD`. O login é apenas do operador do master web. Cada computador client usa sua própria identificação incorporada no instalador, sem usuário ou senha digitados pelo cliente.

Se o site não abrir:

```bash
sudo docker compose --env-file deploy/central.env -f deploy/compose.central.yml logs --tail 80 https master
```

Confira DNS, portas, serviços e certificado. Não compartilhe senhas ou tokens ao enviar diagnósticos. Não tente resolver erros apagando o volume de dados.

## 5. Instalar os computadores

1. No painel **web**, clique em **Baixar client Windows**, no canto inferior esquerdo.
2. Informe um nome exclusivo para aquela máquina, por exemplo `CLIENTE-A-FINANCEIRO-01`.
3. Baixe o `.exe` identificado e instale na máquina correspondente. Gere um nome/instalador diferente para cada máquina. Reutilizar o mesmo instalador para atualizar a mesma máquina preserva sua identificação.
4. Com a máquina conectada à internet, o agente faz o primeiro contato automaticamente. O computador aparece no dashboard após esse contato; a tela atualiza a cada cinco segundos. Não há botão Vincular client nem cadastro de usuário/senha para esse processo.
5. Em **Preferências**, selecione o computador e configure um ou mais destinos de backup: pasta local, HD externo ou caminho UNC, como `\\servidor\Backups`.
6. Em **Backup**, selecione o computador e crie a rotina com origem, dias e horário. Caminhos informados no painel web pertencem ao computador client, não ao VPS. O seletor nativo do Windows continua disponível no master local; no painel remoto, informe os caminhos da máquina correspondente.
7. Clique em **Fazer backup agora**. Confirme o resultado no painel e teste a restauração de um arquivo.

Para rede, o compartilhamento precisa estar acessível ao usuário Windows que executa o agente. Prefira UNC a letras mapeadas, que podem não existir em outra sessão. Nesta versão, VSS para arquivos abertos exige origem local NTFS; uma pasta de rede pode ser destino, mas origem UNC não oferece o mesmo snapshot local.

O agente inicia automaticamente ao entrar no Windows e permanece em segundo plano. Sem um usuário conectado, este agente por usuário não substitui um serviço de backup sem sessão interativa.

## 6. Operar sem servidor do escritório

Deixe **Cópia adicional no escritório** desativada. O backup local/rede, a criptografia e os relatórios para a Locaweb funcionam assim mesmo. Quando nenhum computador usa a cópia adicional, sua coluna fica oculta no dashboard.

O agente envia heartbeat e eventos aproximadamente a cada minuto. O painel mostra ausência de contato após cinco minutos; eventos não entregues ficam em fila para reenvio. Relatórios são separados por identificação do computador. Instalar um client não dá acesso ao dashboard ou às informações das outras máquinas.

A configuração e o agendamento atuais consultam o master: esta versão precisa alcançar o painel para iniciar as execuções gerenciadas e registrar seu andamento. A fila persistente de relatórios não equivale a uma engine de agendamento inteiramente offline. Se o requisito for executar novos backups mesmo com o VPS/internet indisponível por dias, essa autonomia ainda exige uma etapa adicional. O servidor do escritório, por sua vez, é totalmente opcional.

Para máquinas que já usam outro master local: não aponte simplesmente o token/chaves existentes para um VPS novo. São instalações master distintas. Baixe as chaves de segurança dos computadores registrados e preserve os backups; gere novos clients no painel web para a nova implantação. Migrar o master existente com banco e chaves DPAPI para Linux exige um procedimento específico. Atualizar o `.exe` local sozinho não cria nem vincula um VPS.

## 7. Proteger o painel e testar a recuperação

Ao gerar cada client, anote ou baixe sua chave de segurança. Depois, use **Restauração > Restaurar Arquivos de Terceiro > Chave de segurança** para obter a chave de um computador registrado. Guarde as chaves fora do VPS e dos repositórios de backups. Faça também cópia externa consistente do banco e das chaves do volume `control-data`; configure snapshots/backups do VPS e teste a recuperação. Não basta ter somente uma cópia das chaves dentro do próprio servidor.

Os backups antigos sem criptografia permanecem como estavam. Valide uma nova cópia criptografada e uma restauração antes de alterar retenção ou remover versões antigas. Ainda não há retenção automática; acompanhe espaço disponível nos destinos e no VPS.

Para atualizar o painel posteriormente:

```bash
cd /opt/backupdesk
sudo git pull --ff-only
sudo docker compose --env-file deploy/central.env -f deploy/compose.central.yml up -d --build
```

Preserve `deploy/central.env` e o volume. **Não use `down -v`**: isso remove o banco e as chaves do painel. Alterar `ADMIN_PASSWORD` no arquivo não redefine a senha de uma conta já criada.

A cópia adicional no escritório pode ser ativada depois, usando o [roteiro do receptor](README.md#receptor-no-escritório). Contratar o VPS e instalar o painel não configura esse segundo armazenamento automaticamente.
