# Estudo: diferencial por arquivo e backup por blocos

## Conclusão

Para o perfil do BackupDesk, principalmente PSTs grandes e cópia para um servidor remoto, vale evoluir para backup por blocos com deduplicação. A redução potencial de gravação, armazenamento e tráfego é grande quando só partes dos arquivos mudam. Isso não garante a mesma redução no tempo total nem consistência interna de um PST aberto.

A comparação verificável nesta sessão é entre o código atual e técnicas abertas de backup por blocos. O acesso ao site oficial da N-able foi bloqueado pela política de rede do ambiente (HTTP CONNECT 403). Não foi possível auditar o algoritmo interno, os números comerciais ou a oferta de SDK/licença do TrueDelta. Não se deve apresentar uma implementação própria ou o Restic como sendo TrueDelta ou como reprodução exata dele. Considera-se aqui que o nome se refere à tecnologia do Cove/N-able.

## O que o BackupDesk faz hoje

Em `disk-backup.mjs`, a versão completa válida é procurada na janela de cinco dias para a mesma identidade/origem/destino e criptografia compatível. O conteúdo da base é verificado. Cada arquivo da origem é lido para calcular SHA-256 e comparado com o arquivo correspondente da base. Um arquivo modificado é copiado por inteiro, criptografado e relido para conferir a integridade. Arquivos inalterados referenciam a base.

Esse método é diferencial por arquivo. Um PST de 20.000 MB modificado pode gerar outra gravação próxima de 20.000 MB, mesmo que a alteração interna seja pequena. Dias posteriores são comparados à base completa, portanto um arquivo que permaneça diferente da base pode ser gravado inteiro em vários diferenciais.

`encrypted-files.mjs` usa registros autenticados de 4 × 1024 × 1024 bytes, mas esses registros não são um índice de deduplicação: os arquivos modificados são criptografados novamente com material aleatório. Comparar o resultado criptografado não localiza de maneira útil as partes iguais do conteúdo. A deduplicação deve acontecer antes da criptografia.

A cópia para o escritório em `office-client.mjs` retoma uploads em partes, mas a unidade lógica enviada ainda é o objeto que representa o arquivo inteiro modificado. Retomar transmissão não equivale a reutilizar blocos de versões anteriores.

## Experimento reproduzido nesta sessão

Dados sintéticos aleatórios, sem compressão, sem PST real e sem executar TrueDelta ou Restic. Foi executado o motor atual com criptografia, um completo e um diferencial; em paralelo foi simulada uma estratégia simples de blocos fixos de 1.048.576 bytes, que não é CDC.

| Medida | Resultado |
|---|---:|
| Arquivo original | 33.554.432 bytes, aproximadamente 33,55 MB |
| Faixa alterada | 4.096 bytes |
| Tipo decidido pelo BackupDesk | Diferencial |
| Conteúdo lógico regravado pelo motor atual | 33.554.432 bytes |
| Conteúdo novo na simulação por blocos | 1.048.576 bytes |
| Redução de conteúdo novo nessa simulação | 96,875% |
| Restauração do motor atual | SHA-256 correspondente à origem modificada |
| Reconstrução da simulação | SHA-256 correspondente à origem modificada |

Não são medidas de velocidade, de desempenho real de rede nem projeção garantida para Outlook. Criptografia, índices, autenticação e metadados acrescentam volume. Alterações espalhadas, compactação e reorganização interna do PST podem exigir muitos blocos.

## Técnica recomendada

CDC (Content-Defined Chunking) escolhe limites de blocos com base no conteúdo, facilitando reencontrar partes inalteradas mesmo quando há inserções ou remoções que deslocam o arquivo. Hashes fortes identificam os blocos; o índice confirma quais já existem no destino. Somente os blocos ausentes são gravados. Cada versão precisa de um catálogo completo e ordenado de referências aos blocos necessários para restaurar cada arquivo.

A documentação primária do Restic descreve CDC com Rabin Fingerprints, blocos entre 512 KiB e 8 MiB e tamanho médio pretendido de 1 MiB. São parâmetros do Restic, não números confirmados do TrueDelta. A biblioteca de divisão em blocos, isoladamente, não fornece armazenamento, criptografia, recuperação, concorrência ou retenção.

É necessário distinguir:

- Menos dados gravados e enviados: benefício esperado da deduplicação.
- Menos dados lidos da origem: não é garantido. Descobrir alterações pode exigir ler todo o arquivo.
- Menor tempo total: precisa ser medido com VSS, leitura, comparação, criptografia e restauração.
- Consistência do PST: blocos não substituem VSS nem testes de abertura/recuperação no Outlook.

## Como implementar

### Primeiro: protótipo com um motor maduro

Avaliar o Restic como motor do BackupDesk é o caminho inicial recomendado para reduzir a quantidade de código crítico próprio. Ele já possui snapshots, CDC, criptografia, verificação e restauração. A licença principal consultada é BSD de duas cláusulas; uma distribuição precisa revisar e incluir também os avisos das dependências e os termos dos componentes distribuídos. Isso não concede direitos sobre TrueDelta.

O protótipo deve adaptar o motor à interface atual, não expor linha de comando ao usuário. Deve retornar progresso estruturado e catálogo para o calendário. Erros de leitura e snapshots incompletos não podem aparecer como sucesso: a documentação do Restic distingue código 0, erro fatal e código 3 para origem parcialmente ilegível.

Cada computador deve ter seu próprio repositório e credenciais. O master pode receber autorização de recuperação de todos; um client não recebe acesso aos demais. É necessário projetar o vínculo entre as chaves atuais de computador/master e as chaves do novo repositório, inclusive a recuperação por nome e chave BD1 já oferecida. Chaves de repositório não devem aparecer em argumentos, logs ou no navegador.

Preservar o auxiliar restrito de VSS já instalado. Embora o Restic tenha `--use-fs-snapshot`, não se deve assumir que basta habilitar a opção em um processo comum para manter a operação sem solicitações de administrador. Leitura do snapshot e mapeamento dos caminhos de origem exigem integração/testes no Windows.

Para dois destinos, avaliar backup para cada repositório a partir do mesmo ponto consistente e a alternativa de copiar snapshots entre repositórios. A documentação de `restic copy` alerta para custos de leitura/escrita e diferenças de chaves; também exige parâmetros de chunking compatíveis para deduplicação apropriada. Não prometer que copiar repositórios terá automaticamente a mesma economia de fazer backup direto para um destino que já possui os blocos.

No servidor remoto, o `rest-server` documenta repositórios privados e modo append-only. Deve usar HTTPS e autenticação por computador, criadas e gerenciadas pelo aplicativo, sem cadastros manuais adicionais para o usuário. O receptor HTTP atual do BackupDesk não é automaticamente compatível com esse protocolo.

### Alternativa: evoluir o motor nativo

Se manter a regra de completos físicos e o formato próprio for decisivo, um formato novo pode acrescentar CDC ao motor atual:

1. Criar formato versionado novo, mantendo leitura dos formatos existentes. Não converter ou excluir as versões antigas automaticamente.
2. Dividir o conteúdo consistente do VSS em blocos e identificar blocos antes de comprimir/criptografar. Isolar o índice por computador/repositório; evitar deduplicação global entre clientes.
3. Criptografar e autenticar cada objeto novo com construção revisada, nonces únicos e autenticação do contexto. Não implementar primitivas criptográficas próprias nem tornar a criptografia determinística para comparar ciphertext.
4. Guardar um catálogo criptografado completo por versão: ordem dos blocos, comprimentos, hash final, caminhos e datas originais. Referenciar objetos diretamente, evitando longas cadeias de patches.
5. Publicar uma versão somente após confirmar todos os objetos necessários e o catálogo. Usar escrita atômica, retomada, bloqueios e isolamento de operações concorrentes.
6. Adaptar o receptor remoto a objetos por blocos e confirmação de presença/integridade, antes de enviar os novos. Ter uma cópia local não comprova que os blocos também existem na nuvem.
7. Restaurar em fluxo e conferir autenticação e SHA-256 final antes de liberar o arquivo. Manter restauração sem sobrescrever os originais.
8. Implementar retenção com análise das referências de todas as versões. Um bloco compartilhado não pode ser apagado enquanto houver versão que dependa dele. Acrescentar verificação periódica e proteção contra exclusão de backups pelo client.
9. Registrar nos logs: base escolhida, motivo do completo/diferencial, razão de rejeição da base, dados lidos, blocos reutilizados, blocos novos, conteúdo lógico e bytes realmente gravados/enviados.

Essa alternativa dá mais controle de compatibilidade, mas exige mais desenvolvimento e validação de segurança e recuperação. Adicionar apenas uma biblioteca de CDC não a conclui.

## Regra dos cinco dias

Preservar o comportamento contratado até haver uma decisão explícita de produto. “Completo” pode significar:

- **Completo físico:** uma cópia independente nova de todos os dados. Para independência real, ela não pode depender dos blocos dos ciclos anteriores.
- **Completo lógico/sintético:** catálogo completo dos arquivos, compartilhando blocos já armazenados. É uma restauração completa, mas não uma nova cópia física independente.

Usar snapshots de um motor incremental contínuo e chamá-los de novos completos físicos seria incorreto. A regra de cinco dias deve ser representada como ciclos de bases independentes se essa independência continuar sendo o requisito. Um catálogo novo ou uma opção de releitura forçada não obrigam um motor de deduplicação a regravar fisicamente todos os dados. Verificação integral a cada cinco dias é outra política, não equivalente a gerar um completo físico.

## Critérios antes da implantação

Comparar o motor atual e o protótipo com PSTs reais de diferentes tamanhos, com Outlook aberto e VSS, alterações pequenas, compactação/reorganização, remoção e adição de mensagens. Medir leitura, tráfego, gravação, CPU, espaço e duração total. Restaurar versões escolhidas pelo calendário e conferir tanto hashes como abertura no Outlook. Testar interrupção de energia/rede, destino indisponível, falta de espaço, corrupção de objetos compartilhados e recuperação em outra instalação usando as duas formas de chave. Manter compatibilidade com backups antigos e validar isolamento entre computadores.

## Fontes primárias abertas consultadas

- Arquitetura, CDC, armazenamento e segurança do Restic: https://github.com/restic/restic/blob/master/doc/design.rst
- Biblioteca oficial de CDC: https://github.com/restic/chunker
- Backup, VSS no Windows e códigos de saída: https://github.com/restic/restic/blob/master/doc/040_backup.rst
- Cópia entre repositórios e ressalvas de deduplicação: https://github.com/restic/restic/blob/master/doc/045_working_with_repos.rst
- Servidor, repositórios privados e append-only: https://github.com/restic/rest-server
- Licença principal: https://github.com/restic/restic/blob/master/LICENSE

Esta pesquisa não alterou o motor de produção nem o instalador. O experimento foi feito em diretórios temporários e removido ao terminar. O acesso às páginas oficiais do fornecedor do TrueDelta permanece necessário para confirmar sua descrição comercial, detalhes publicados e condições de integração.
