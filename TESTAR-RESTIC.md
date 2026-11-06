# Piloto Restic — BackupDesk 0.21.0

## Preparação

Atualize master e client para 0.21.0. Escolha primeiro um computador e uma pasta de teste; mantenha os backups anteriores. Em **Preferências → Desempenho → Motor de backup**, selecione **Restic — piloto por blocos** e salve. Configure um destino local, HD externo ou compartilhamento de rede. O receptor HTTPS antigo do escritório ainda não recebe este formato; o acompanhamento online continua independente do armazenamento.

No Windows, selecione pastas dentro da unidade. A unidade inteira e arquivos soltos diretamente na raiz ainda exigem o motor anterior neste piloto.

Guarde a chave de segurança fora da pasta dos backups. Reserve espaço para uma primeira cópia de todos os dados selecionados. Para transportar um repositório, copie **toda a pasta BackupDesk, inclusive a pasta oculta .restic**; uma pasta de execução isolada não contém todos os blocos.

## Sequência de testes

| Ação | Resultado esperado |
| --- | --- |
| Executar a primeira rotina | Snapshot completo, dados criptografados e verificação integral aprovada. |
| Repetir sem mudar os arquivos | Novo ponto de restauração; poucos bytes físicos novos, principalmente metadados. |
| Alterar uma pequena parte de um arquivo grande | Gravação dos blocos novos; não é necessário repetir o arquivo inteiro no destino. O ganho depende dos dados e do formato do arquivo. |
| Adicionar, renomear e excluir arquivos na origem | O calendário e a árvore refletem cada versão. A exclusão na origem não remove as versões anteriores. |
| Restaurar a primeira e a última versão para outra pasta | Conteúdo correto para cada data, SHA-256 conferido pelo programa e data de modificação preservada. |
| Restaurar somente um arquivo ou subpasta | Apenas a seleção é recuperada. |
| Usar a chave do computador e repetir pelo master | As duas formas autorizadas recuperam os mesmos dados. |
| Interromper uma cópia de teste e executar novamente | A execução incompleta não aparece como backup aprovado. Versões anteriores continuam restauráveis. Conflitos de acesso/lock são tratados como falha; não apague locks manualmente. |
| Desconectar um destino de teste | Falha identificada, sem declarar concluída a cópia ausente. Reconecte e execute novamente. |
| Executar após cinco dias do último check aprovado | Nova verificação de todos os dados do repositório; somente o sucesso avança a data de verificação. |

Registre em cada execução: computador, origem, destino, horário, tamanho lógico, bytes gravados, duração e resultado da restauração. Compare o mesmo conjunto no mesmo destino; cada destino tem seu próprio repositório e primeira cópia. A deduplicação reduz armazenamento/transferência, mas a leitura e conferência da origem ainda podem consumir tempo.

O snapshot completo do Restic é uma visão lógica de todos os arquivos daquele momento, com blocos compartilhados entre versões. A regra de cinco dias passa a exigir **verificação integral**, não uma segunda cópia física completa. Essa verificação ocorre durante uma execução de backup; não há verificação independente quando nenhuma rotina executa. Falha no check não publica um ponto aprovado nem altera o último check bem-sucedido. Não há exclusão automática de versões neste piloto.

## PST e aprovação do piloto

No Windows, teste com o Outlook aberto e restaure uma cópia para outra pasta. Abra essa cópia no Outlook e confira pastas, mensagens recentes e anexos. A conferência criptográfica confirma a leitura íntegra dos blocos; não confirma sozinha a consistência interna de um PST. O teste automatizado Windows usa um arquivo sintético bloqueado, não um PST real.

Mantenha o piloto por 7–14 dias, incluindo uma verificação de cinco dias e restauração em outra instalação. Considere aprovado somente depois de recuperar e abrir os arquivos necessários. Não provoque corrupção no único backup válido; esse cenário já é exercitado pela suíte automatizada sobre repositórios descartáveis.

O limite de banda configurado vale por toda a operação Restic e é capturado quando ela começa. O agendamento por horário e alterações durante uma execução ainda não são reaplicados ao processo ativo.
