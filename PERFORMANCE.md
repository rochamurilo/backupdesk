# Desempenho — 0.30.0

A análise encontrou espaço para reduzir gravações e tráfego de metadados durante o backup. Em repouso, o consumo de CPU já era baixo. A 0.30.0 reduz a prioridade dos processos locais, limita o paralelismo do Restic e conserva as verificações de integridade.

## Comparação de laboratório

Mesma máquina Linux, Node.js 24.19.0, AMD EPYC 9V74 com cinco CPUs lógicas disponíveis. Agente e API reais, 1.500 arquivos de 2.048 bytes e quatro arquivos de 16 MiB com conteúdo aleatório: 1.504 arquivos, 70.180.864 bytes lógicos. Destino local, Restic, criptografia e verificação integral habilitados, limitador de velocidade desativado. Aquecimento de dez segundos, quinze segundos em repouso e um backup completo por versão. Um proxy local contabilizou as chamadas; os contadores de CPU incluem processos filhos encerrados. A memória foi amostrada a cada 150 ms. O benchmark não inclui navegador, supervisor ou componente VSS do Windows.

| Medida | 0.29.0 | 0.30.0 |
| --- | ---: | ---: |
| Requisições para registrar arquivos | 1.504 | 16 |
| Transações confirmadas no banco durante o backup | 3.077 | 54 |
| Tempo do backup, incluindo fila e conferência | 12,79 s | 9,18 s |
| Tempo de CPU acumulado durante o backup | 9,77 s | 7,65 s |
| Pico amostrado de memória durante o backup | 249,0 MB | 155,4 MB |
| CPU em repouso, percentual de um núcleo | 0,27% | 0,13% |
| Memória em repouso | 122,5 MB | 123,4 MB |
| Transações no banco na janela de 15 s em repouso | 8 | 0 |

O catálogo e o volume lógico foram preservados nas duas execuções, com verificação de integridade aprovada. As maiores reduções foram nas requisições de catálogo e nas transações, ambas superiores a 98%. O consumo de memória em repouso permaneceu semelhante. O percentual médio de CPU durante o backup pode aumentar quando a mesma tarefa termina mais rápido; por isso a comparação usa também o tempo total de CPU consumido.

Os números descrevem este cenário de laboratório. Hardware, antivírus, disco, rede e carga de trabalho alteram os resultados. A prioridade reduzida favorece aplicativos concorrentes, mas o backup continua utilizando CPU, memória, disco e rede. Para controlar a disputa por disco e rede, configure os limites de envio e leitura em **Preferências → Desempenho** e escolha horários adequados. Limites menores podem prolongar a rotina.

## Alterações

- Catálogo enviado em lotes de até 100 arquivos ou 256 KiB, com confirmação de todos os registros antes de aprovar o backup. Cada lote usa uma transação atômica e as mesmas validações por arquivo. Uma falha reverte todo o lote.
- Consultas do agente continuam frequentes para manter o cancelamento responsivo; o contato é persistido no banco a cada trinta segundos, imediatamente na troca de versão e após retorno do relógio. Não há uma escrita durável por consulta.
- Processos locais usam prioridade inferior à dos aplicativos comuns. O Restic recebe até dois processadores lógicos, um leitor de arquivo e duas conexões no transporte local. Um limite de processadores menor definido no ambiente é preservado. O servidor web em modo nuvem mantém sua prioridade normal.
- Os limites configurados também se aplicam à leitura usada no cálculo dos hashes de origem. Os hashes, a criptografia, a validação por arquivo e a conferência integral do Restic a cada cinco dias permanecem habilitados.
- O componente VSS já aguardava conexões em um pipe bloqueante; sua espera não foi convertida em consultas periódicas.

## Repetir a medição

`node checks/performance.mjs /tmp/performance.json` usa dados temporários, mede os processos e remove as cópias de teste ao finalizar. `BKD_BENCH_ROOT` permite apontar para outra cópia do aplicativo com o Restic Linux validado em `bin/restic`. Evite executar outros testes ou compilações junto com a medição. Consulte os resultados brutos em [0.29.0](checks/results/performance-0.29.0.json) e [0.30.0](checks/results/performance-0.30.0.json).

Os testes Windows verificam a prioridade dos processos instalados, os atalhos, a restauração e a preservação das chaves. Na [execução 43029392226](https://github.com/rochamurilo/backupdesk/actions/runs/43029392226), o Client instalado em Windows Server 2025, com quatro CPUs lógicas, apresentou 270,1 MB de memória residente somada nos quatro processos medidos: supervisor, API, agente e componente VSS. A amostra de dez segundos não registrou aumento detectável no contador de CPU (0,00% de um núcleo após arredondamento). O navegador não foi incluído. Essa janela curta é uma observação de repouso, não uma garantia de consumo nulo nem uma comparação com a versão anterior no Windows.
