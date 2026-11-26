# Recuperação do componente VSS — 0.37.1

O diagnóstico do SERVIDORPB mostrou uma tentativa de inicialização que falhou ao publicar `startup.json`, enquanto outra instância estava pronta, além de conexões interrompidas e operações VSS demoradas. O teste posterior `automaticVssStatus()` confirmou que o componente estava acessível naquele momento. Isso não permite atribuir todas as falhas à outra ferramenta de backup.

Esta versão inclui:

- Exclusão entre instâncias por um handle de arquivo no diretório protegido do componente. O Windows libera o handle ao encerrar o processo; um arquivo remanescente não bloqueia a próxima inicialização. Uma tentativa duplicada não substitui o estado da instância ativa.
- Publicação atômica dos registros sem a janela entre verificar a existência e mover o arquivo.
- Leitura e escrita do canal com prazo, limite de tamanho e cancelamento do I/O pendente no próprio handle. Uma conexão abandonada não mantém o broker preso numa leitura ou resposta.
- Espera de até 90 segundos para conectar operações após iniciar uma tarefa parada. A sondagem mantém um prazo menor. O processo chamador comporta a espera e a resposta.
- Registro da fase de comunicação que falhou.

As permissões SYSTEM/usuário e o registro de propriedade dos snapshots continuam obrigatórios. Não há reinício global dos serviços VSS, exclusão de snapshots de outros programas ou repetição automática de `create` após uma resposta desconhecida. Uma operação VSS ainda ativa não é substituída por outra.

A instalação do atualizador é necessária para substituir tanto os scripts do aplicativo quanto o componente protegido. Não é necessário reinstalar nem apagar dados ou chaves. Esta correção não inclui o trabalho de USN da outra branch.

A versão não pode garantir que um provedor VSS do Windows nunca ficará lento ou falhará. Se persistir uma falha na fase `operation`, o novo registro permite investigar separadamente a operação do Windows.
