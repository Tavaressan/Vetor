# MCPs incluídos

O plugin já traz três servidores MCP. O Claude Code usa *tool search* por padrão, então os schemas ficam diferidos e o custo de contexto é baixo.

| Servidor | Para quê | Requer |
|----------|----------|--------|
| `context7` | Documentação atualizada de bibliotecas, direto na sessão | Nada. A API key é opcional (só aumenta o rate limit) e é pedida na habilitação do plugin |
| `chrome-devtools` | Dirigir o Chrome: navegar, screenshot, rede, performance trace, Lighthouse | Node (`npx`) e Chrome |
| `docker` | O Docker CLI inteiro (`ps`, `logs`, `stats`, `compose`, `exec`) via o servidor **oficial da Docker Inc.** — uma única ferramenta | Docker + plugin `docker mcp` |
| `ai-memory` | Memória local persistida para agentes, com consolidação/sumarização opcional | **Não embarcado** — opcional, configurado à parte via Docker/Podman Compose (ver abaixo) |

**Trabalhando dentro do próprio repositório do Vetor:** o `.mcp.json` da raiz também é lido como config de
projeto, que tem precedência sobre o plugin — e nele `${user_config.*}` e `${CLAUDE_PLUGIN_ROOT}` não são
substituídos. Por isso `.claude/settings.json` traz `"disabledMcpjsonServers": ["context7", "docker"]`:
as cópias de projeto ficam desativadas e as do plugin (`plugin:vetor:*`) conectam (#433). Não remova essa
entrada.

## ai-memory local com Docker Compose

Copie `templates/docker-compose.ai-memory.yml` para a raiz do projeto e crie um `.env` ao lado. O Compose persiste o diretório de dados completo em `.ai-memory/` (SQLite e wiki Markdown ficam sob esse diretório) e publica o MCP apenas em loopback, na porta `49374`.

O servidor funciona sem LLM, usando busca FTS5 e resumos por regras — é o comportamento quando o `.env` não define `AI_MEMORY_LLM_PROVIDER`. Para habilitar consolidação/sumarização em background, configure um backend OpenAI-compatible no `.env`.

### Ollama local

```dotenv
AI_MEMORY_LLM_PROVIDER=openai-compat
AI_MEMORY_LLM_BASE_URL=http://host.docker.internal:11434/v1
AI_MEMORY_LLM_MODEL=qwen2.5-coder:14b
```

No Linux, `host.docker.internal` pode exigir configuração do Docker Engine; ajuste a URL para o endereço acessível a partir do container. O nome do modelo deve existir no Ollama.

### OpenRouter

```dotenv
AI_MEMORY_LLM_PROVIDER=openai-compat
AI_MEMORY_LLM_BASE_URL=https://openrouter.ai/api/v1
AI_MEMORY_LLM_MODEL=deepseek/deepseek-v4-flash
AI_MEMORY_LLM_COMPAT_STRICT=true
LLM_API_KEY=sk-or-v1-...
```

Use o ID de modelo vigente na sua conta. **Não versione o `.env` nem a chave**; mantenha o arquivo local e use somente placeholders em exemplos e commits.

Inicie com `docker compose -f docker-compose.ai-memory.yml up -d`. A configuração do servidor MCP no `.mcp.json` do cliente/projeto é:

```json
{
  "mcpServers": {
    "ai-memory": {
      "type": "http",
      "url": "http://127.0.0.1:49374/mcp"
    }
  }
}
```

`vetor doctor` verifica essa declaração de modo informativo: mostra conectado, indisponível ou não configurado sem alterar o exit code. Para conferir ferramentas e `memory_status` manualmente, execute `deno run --allow-net scripts/ai-memory-check.ts http://127.0.0.1:49374/mcp`.

### Escopo do projeto (`.ai-memory.toml`)

As skills do Vetor só consultam e registram memória quando o `.ai-memory.toml` mais próximo declara **ambos** `workspace` e `project` (ver `skills/shared/references/memory-gotchas.md`). O `/vetor:install` oferece criar o arquivo na raiz do projeto, sem sobrescrever um existente e sem subir o container:

```toml
workspace = "meu-workspace"
project = "meu-projeto"
```

Versione o arquivo para que todo checkout e worktree resolva o mesmo escopo. Os nomes não podem ser vazios nem conter `/`, `\`, espaços ou caracteres de controle. Fonte: [docs/marker-file.md](https://github.com/akitaonrails/ai-memory/blob/main/docs/marker-file.md) do ai-memory, consultada em 2026-10-26.

Fontes oficiais do ai-memory consultadas em 2026-10-15: [README — Docker](https://github.com/akitaonrails/ai-memory#docker) (imagem `akitaonrails/ai-memory:latest`, porta `49374` em loopback, dados em `/data`) e [docs/llm-providers.md — OpenRouter](https://github.com/akitaonrails/ai-memory/blob/main/docs/llm-providers.md#openrouter) (`openai-compat` + `AI_MEMORY_LLM_BASE_URL` + `LLM_API_KEY`; não existe provider `openrouter`).

Sobre o servidor `docker`:

- Ele é o [servidor oficial](https://github.com/docker/mcp-registry) da Docker (Apache-2.0), mas **não faz parte do catálogo distribuído** (`mcp/docker-mcp-catalog:latest` só traz servidores do tipo `image`). Por isso o plugin embarca `mcp/docker-catalog.yaml` e passa `--catalog` ao gateway. Sem isso, `docker mcp gateway run --servers docker` sobe com *0 tools*.
- **Sem Docker Desktop recente:** o gateway roda em Docker Engine/CE — baixe o binário do [docker/mcp-gateway](https://github.com/docker/mcp-gateway) para `~/.docker/cli-plugins/` e, se necessário, exporte `DOCKER_MCP_IN_CONTAINER=1`.
- ⚠️ **Superfície de risco:** a ferramenta monta `/var/run/docker.sock` e executa o Docker CLI com o poder do daemon. É inerente a qualquer MCP de Docker. Remova o servidor do `.mcp.json` se não quiser essa superfície.

---

[← Wiki do Vetor](Home.md)
