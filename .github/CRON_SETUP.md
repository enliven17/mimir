# GitHub Actions - Cron Sync Setup Guide

Este workflow executa a reconciliação do índice VS a cada 5 minutos automaticamente usando GitHub Actions.

## 📋 Configuração Necessária

### 1. Configure os Secrets no GitHub

Acesse: `Settings → Secrets and variables → Actions`

Adicione 2 secrets:

| Secret | Valor | Exemplo |
|--------|-------|---------|
| `PRODUCTION_URL` | URL base da sua app em produção | `https://mimir.yourapp.com` |
| `CRON_SECRET` | Valor do `CRON_SECRET` em produção | (mesmo valor de `.env` em produção) |

**⚠️ Importante:**
- `PRODUCTION_URL`: deve ser acessível publicamente (sem trailing slash)
- `CRON_SECRET`: mantenha confidencial, nunca commite no código

### 2. O Workflow Executa Automaticamente

A partir do primeiro commit, o workflow:
- ✅ Roda a cada 5 minutos (horário UTC)
- ✅ Chama `POST /api/cron/sync?secret={CRON_SECRET}`
- ✅ Valida HTTP 200/201
- ✅ Verifica se há erros na resposta
- ✅ Falha (com notificação) se o sync não funcionar

### 3. Monitorar Execuções

GitHub Actions → `Cron - Index Reconciliation` → veja logs de cada rodada

---

## 🔧 Customizações

### Mudar frequência de execução

Edite `.github/workflows/cron-sync.yml`, linha 8:

```yaml
- cron: '*/5 * * * *'   # A cada 5 min
- cron: '0 * * * *'     # A cada 1 hora
- cron: '0 0 * * *'     # Uma vez por dia
```

[Aprenda sobre cron syntax](https://crontab.guru/)

### Desabilitar temporariamente

Renomeie o arquivo ou delete a seção `on:` do YAML.

---

## 🚨 Troubleshooting

### "Workflow file has an error"
- Verifique YAML syntax (indentação)
- Limpar `.github/workflows/cron-sync.yml` e recriar se necessário

### "secret variable is empty"
- Confirme `PRODUCTION_URL` e `CRON_SECRET` estão definidas em Settings → Secrets
- Nomes são case-sensitive

### "Cron endpoint failed with status 404"
- `PRODUCTION_URL` está correto?
- O app está online?
- Teste manualmente: `curl -X POST "https://yourapp.com/api/cron/sync?secret=YOUR_SECRET"`

### "Cron endpoint failed with status 401"
- `CRON_SECRET` está errado
- Confirme em Settings → Secrets

---

## ✅ Verificar que Está Funcionando

1. Acesse GitHub Actions
2. Clique em `Cron - Index Reconciliation`
3. Clique em `Run workflow` → `Run workflow` (teste manual)
4. Aguarde ~10 segundos, veja o resultado
5. Se verde ✅: está pronto! Continuará rodando a cada 5 min automaticamente
