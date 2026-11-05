# Criptografia do BackupDesk 0.12.0

## Modelo e limites de confiança

Novos backups gerenciados em disco usam AES-256-GCM antes de gravar conteúdo ou nomes no destino. O formato v3 tem arquivos de nomes aleatórios, catálogo criptografado manifest.bde e um cabeçalho público key-envelope.json. Diretórios expõem identificações opacas e quantidade/tamanho dos objetos; o cabeçalho não contém nomes de documentos, chave de dados em claro ou chave privada.

Uma chave aleatória de dados de 256 bits é criada por identificação de computador. Ela é protegida para dois destinatários com RSA-3072/OAEP-SHA256: o computador e o master. O ID é SHA-256 da chave aleatória, usado para conferir que as duas formas recuperam a mesma chave. Não é derivado de senha humana.

Cada arquivo usa uma chave derivada por HKDF-SHA256 com salt aleatório de 256 bits e AAD ligada ao objeto e chave de dados. O arquivo é dividido em registros de até 4 MiB, cada qual autenticado com AES-GCM, nonce de prefixo aleatório + contador e AAD de índice/tamanho. Há um registro final autenticado, que detecta truncamento. Isso evita tratar arquivos de centenas de GB como uma única mensagem GCM. A memória de transferência é limitada ao bloco. Não é compressão, deduplicação ou cópia diferencial de blocos.

O computador protege sua chave privada com **Windows DPAPI / CurrentUser**, sem pedir senha a cada backup. O master Windows faz o mesmo. Em Linux, BACKUPDESK_KEY_PASSWORD usa scrypt (N=32768,r=8,p=1) + AES-GCM; o modo online exige essa proteção. Em teste Linux sem essa variável, usa arquivos restritos ao proprietário (diretório 700, arquivo 600); isso não é criptografia da chave em repouso. Configurar a variável e proteção de disco antes de hospedar.

A recuperação exportada é cifrada por scrypt + AES-GCM com salt/nonce aleatórios. O operador deve guardar arquivo e senha fora do computador/repositório. Atualizações preservam DATA_DIR/keys e a identidade. Não se deve apagar chaves para resolver erros de configuração. Formatação do Windows ou troca de usuário pode impedir abertura por DPAPI; usar a recuperação do master em outra instalação e uma nova identidade para o computador substituído. A rotação automática de todas as chaves ainda não é implementada.

## Escopo de autorização

Tokens de agente não são contas master. O servidor vincula cadastro de chaves, configurações, relatórios e tarefas ao computador autenticado. Contas de cliente só enxergam seus dispositivos; o master acompanha todos. Um computador não recebe a chave privada do master. O registro também exige prova de posse da chave de dados por HMAC ligada ao computador, chave e chave pública; copiar um cabeçalho de outra máquina não permite registrá-lo como próprio para obter recuperação.

Em uma recuperação autorizada, o servidor abre somente a chave de dados solicitada e a envolve para a chave pública do computador que executará a tarefa. A tarefa precisa estar ativa, vinculada ao computador e, na restauração, à chave da versão selecionada. Recuperações entre computadores exigem autorização master. No painel local, o master confirma sua senha e autoriza a recuperação de outras máquinas por 15 minutos; exportação/importação exige confirmação de senha. Login online autenticado autoriza as operações da conta master. O painel local sem senha pressupõe uma sessão Windows confiável e não é uma fronteira de segurança contra processos maliciosos nesse usuário.

O servidor master é uma autoridade de recuperação: quem comprometer sua conta/servidor pode comprometer os dados que ele administra. O receptor do escritório tem apenas dados criptografados e tokens de transporte por computador; não tem as chaves privadas. Criptografia não impede exclusão física de arquivos ou perda do disco. As versões confirmadas do receptor são imutáveis pela API de agente, mas administração do servidor e retenção exigem controles próprios.

## Integridade e migração

Criptografia é sempre ativa nos novos backups gerenciados; não há caixa para desabilitar. Agentes anteriores devem ser atualizados para continuar novas cópias. O primeiro backup v3 é completo: não pode depender de uma base em texto aberto. Diferenciais posteriores só reutilizam completos v3 com a mesma chave, máquina, origem e destino na janela de cinco dias.

Backups antigos v1/v2 permanecem legíveis e não são apagados ou convertidos silenciosamente. Só devem ser removidos pelo responsável depois de verificar uma nova cópia criptografada e sua recuperação, preservando as bases necessárias. Não é seguro achar que arquivos antigos foram protegidos apenas porque o programa foi atualizado.

Cada arquivo é autenticado e comparado por SHA-256 durante cópia e recuperação. A restauração descriptografa para um arquivo temporário; só publica o nome final depois de autenticar todos os blocos, validar o hash e reler o arquivo gravado. Falhas removem o temporário dessa restauração. O catálogo usa AES-GCM e guarda as referências dos diferenciais de forma criptografada. Manifestações de erro não gravam catálogos de nomes em claro no destino v3.

A criptografia protege a cópia em repouso, mas não valida a estrutura lógica de um PST nem cria consistência de aplicação. VSS continua sujeito às condições documentadas. Use uma recuperação real no Outlook para validar PSTs de produção.
