# Critérios de verificação do BackupDesk

Cada alteração no fluxo de backup deve ser revisada considerando:

- Origem explícita e acessível; destino explícito no computador correto.
- Pasta local, HD externo e rede usam as permissões do usuário. Não substituir silenciosamente um destino indisponível por outro.
- Bloquear destino dentro da origem, confirmar acesso de gravação e espaço disponível.
- Arquivos grandes devem ser copiados em fluxo; não carregar todo o conteúdo na memória.
- Preservar versões anteriores e originais, verificar hashes e só registrar sucesso após concluir e verificar a cópia.
- Interrupções, corrupção e discos indisponíveis devem aparecer como falha, sem sucesso falso.
- Testar uma restauração real e comparar o conteúdo, preservando os originais.
- Validar mudanças no agendamento, edição de rotinas, vinculação de clients e compatibilidade de versões.
- Distinguir testes Linux/navegador de validação nativa Windows, HD USB e SMB real.
- Não prometer consistência de aplicações abertas, VSS, criptografia, retenção ou recuperação de desastre sem implementar e validar essas capacidades.

A versão 0.9.0 faz completo ou diferencial cumulativo com base completa dos últimos cinco dias, por máquina/origem/destino. Verificar a base, preservar referências e testar restauração de arquivos alterados, iguais e excluídos; diferenciais não podem depender de outros diferenciais. Histórico limitado a dez linhas não pode apagar o catálogo ou a base.

VSS é obrigatório no Windows para os backups em disco, com acesso a arquivos abertos testado em arquivo bloqueado. SHA-256 verifica o conteúdo copiado; não valida a estrutura lógica de PST. A abertura de PST real no Outlook ainda precisa ser testada em uma cópia restaurada. Não apresentar essa validação como concluída sem executá-la. Ainda não é uma solução pronta para ser a única cópia de dados de produção.

Para preferências e múltiplas cópias, verificar limitação real de bytes (incluindo janela que atravessa meia-noite), aplicação a todas as rotinas do computador e ausência de sucesso global quando um destino falhar. Um destino indisponível não pode redirecionar silenciosamente a gravação nem impedir a tentativa nos demais. Revalidar política atual ao entregar comandos que estavam em fila.

Para repositórios externos, testar recuperação com o caminho original indisponível, diferencial com base local ao repositório escolhido, falha explícita sem base e proteção contra referências fora do repositório. Leitura/importação do catálogo não pode registrar um novo backup, alterar os arquivos originais ou descartar um catálogo anterior se a leitura falhar. Repetir a importação não deve acumular cópias duplicadas do catálogo.
