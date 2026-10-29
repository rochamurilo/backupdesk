# BackupDesk — protótipo local

Painel e API Node.js 24 com SQLite, sem dependências de terceiros. Interface inspirada na organização de consoles de proteção de dados: indicadores, tabela de equipamentos, histórico de 28 dias, calendário mensal e restauração por arquivo.

## Executar

```sh
cd /workspace/backupdesk
npm start
```

Abra http://127.0.0.1:3000 no computador que executa o servidor. As credenciais iniciais são geradas em `data/initial-admin.txt` com permissão restrita. É possível definir `ADMIN_PASSWORD` antes da primeira execução. O usuário inicial é `admin`. `DATA_DIR`, `HOST` e `PORT` são opcionais. O servidor escuta somente na interface local por padrão.

No painel, crie um usuário client e cadastre um computador associado a ele. Guarde o token exibido após o cadastro. O client vê somente seus equipamentos, rotinas, execuções e arquivos. O master vê todos.

## Testar backup real

Com Node.js 24 instalado no computador de teste, baixe `agent.mjs` no painel e defina `BACKUPDESK_URL` e `BACKUPDESK_TOKEN` no ambiente do processo. Não salve tokens no repositório.

```sh
node agent.mjs --once /caminho/da/pasta-de-teste
```

Sem `--once`, o agente consulta as rotinas a cada minuto. Diárias executam após o horário local configurado; semanais nas segundas e mensais no dia 1. Não há recuperação automática de dias perdidos nesta versão. O arquivo de estado local evita repetir a mesma rotina no mesmo dia. Defina `BACKUPDESK_AGENT_STATE` para escolher seu caminho. O processo precisa permanecer aberto; ainda não é serviço Windows/Linux.

Confira o resultado no histórico, abra os arquivos e use Restaurar arquivo para baixar a cópia. O servidor valida o SHA-256 do conteúdo antes da restauração. Objetos idênticos são armazenados uma vez; os arquivos ainda são enviados integralmente.

## Validação

```sh
npm test
```

Teste integrado de autenticação, isolamento de client, bloqueio de caminho inválido, recebimento de arquivo, conclusão e restauração do conteúdo original.

## Limites atuais

Use apenas dados de teste. Arquivo individual limitado a 16 MiB; uploads em JSON/base64, sem retomada ou transferência por blocos. Arquivos alterados durante a leitura causam falha; links simbólicos são ignorados. Não há VSS, suporte consistente a Outlook/bancos abertos, criptografia em repouso, retenção/expurgo, alertas de backups ausentes, instalador, revogação de tokens, expiração de sessões ou limitação de tentativas de login. Sessões ficam na memória e são perdidas ao reiniciar. O armazenamento fica em `data/blobs` no servidor da aplicação.

Não publicar diretamente na internet. Antes da implantação: endurecer autenticação e gestão de credenciais, HTTPS, separar receptor de dados no escritório, transferências em blocos, cifragem, retenção, agente como serviço e testes Windows/VSS/Linux. Os 4,35 TB planejados exigem essa próxima etapa; o protótipo não atende essa escala.

O login usa scrypt com salt fixo nesta versão e deve migrar para salt aleatório por usuário antes de produção.

## Instalador Windows x64

O artefato `dist/BackupDesk-Setup-0.1.0-x64.exe` instala o painel local e o agente por usuário, com runtime Node.js incluído. Windows 10/11 x64. No menu Iniciar: **Painel local**, **Configurar agente**, **Iniciar agente** e **Instruções**. Acesse o painel e cadastre um computador para obter o token antes de configurar o agente. O mesmo pacote pode ser usado só como agente: não abra Painel local nessa máquina.

Consulte [as instruções completas](windows/LEIA-ME.txt). O instalador não tem assinatura digital e não foi executado em Windows neste ambiente Linux. Não instala serviço nem inicia com o Windows. Configuração e dados locais são preservados na desinstalação. O script PowerShell respeita a política de execução do computador; políticas corporativas podem exigir aprovação/assinatura do script.

Para recompilar em Linux: instale NSIS, curl, unzip, ripgrep e sha256sum e execute `bash windows/build.sh`. Opcionalmente, defina `MAKENSIS` e `NSISDIR` para um compilador extraído em diretório local. O script baixa Node.js 24.19.0 oficial e confere SHA-256 antes de empacotar. Não inclui credenciais nem dados de desenvolvimento. O instalador pode ser baixado por usuários autenticados no painel quando o artefato estiver presente em `dist/`.
