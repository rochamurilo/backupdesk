Compilação corrigida da versão 0.37.0, a partir do commit b77d8d9283cdcbd725f082c80cdc0c873810562b (PR #1).

Corrige a falha “O catálogo Restic excedeu o limite do piloto” processando a listagem por registro. A versão interna permanece 0.37.0; estes arquivos contêm a correção adicional do catálogo.

Para a instalação Master existente, execute `BackupDesk-Atualizacao-Master-0.37.0-x64.exe`, com o mesmo usuário e na mesma pasta da instalação. Aguarde os backups em andamento terminarem antes de atualizar. Para Clients existentes, use o atualizador Client. O instalador Master completo é destinado a novas instalações.

Validação: 10 testes Linux passaram, incluindo catálogo simulado com 118.922 registros e mais de 64 MiB, Restic real, restauração, corrupção, API, origem de rede e bloqueios. Os pacotes são extraídos e comparados às fontes corrigidas, Node e Restic verificados. A validação Windows das fontes passou nos três jobs: VSS, rede SMB e atualização. Execução: https://github.com/rochamurilo/backupdesk/actions/runs/44150891297 .

Esta compilação não é assinada digitalmente. A execução dos instaladores desta compilação no Windows ainda não foi validada.
