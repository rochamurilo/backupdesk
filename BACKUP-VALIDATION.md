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

A versão 0.5.0 copia em versões completas, sem deduplicação/retenção automáticas. PST/OST requer Outlook fechado. Ainda não é uma solução pronta para ser a única cópia de dados de produção.
