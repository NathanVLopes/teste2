# NAVETRAN ACA, REMIA e PIA

Sistema web institucional para a NAVETRAN, com dois módulos separados:

- Administrativo: cadastro de condutores, responsáveis legais, equipamentos, provas, ACA e PIA.
- Fiscalização: consulta e validação por QR Code/token, PIA, CPF ou identificador do condutor.

## Executar

```powershell
& "C:\Users\nathan.lopes\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
```

Depois acesse:

- Administrativo: http://localhost:3000/admin/
- Fiscalização: http://localhost:3000/fiscal/

## Usuários iniciais

- Admin: `admin` / `Navetran@2026`
- Atendimento: `atendimento` / `Atende@2026`
- Fiscalização: `agente` / `Fiscal@2026`

## Segurança e separação

- APIs separadas em `/api/admin/*` e `/api/fiscal/*`.
- Sessões distintas por módulo.
- Fiscalização não possui rotas de edição ou cadastro.
- Senhas com PBKDF2 e sal individual.
- CPF/CNPJ e tokens são armazenados com criptografia/derivações de busca.
- QR Code carrega apenas token opaco, sem dados pessoais.
- Logs de acesso registram ações administrativas e consultas de fiscalização.

