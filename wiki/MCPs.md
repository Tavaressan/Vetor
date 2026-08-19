# MCPs incluídos

O plugin já traz três servidores MCP. O Claude Code usa *tool search* por padrão, então os schemas ficam diferidos e o custo de contexto é baixo.

| Servidor | Para quê | Requer |
|----------|----------|--------|
| `context7` | Documentação atualizada de bibliotecas, direto na sessão | Nada. A API key é opcional (só aumenta o rate limit) e é pedida na habilitação do plugin |
| `chrome-devtools` | Dirigir o Chrome: navegar, screenshot, rede, performance trace, Lighthouse | Node (`npx`) e Chrome |
| `docker` | O Docker CLI inteiro (`ps`, `logs`, `stats`, `compose`, `exec`) via o servidor **oficial da Docker Inc.** — uma única ferramenta | Docker + plugin `docker mcp` |

Sobre o servidor `docker`:

- Ele é o [servidor oficial](https://github.com/docker/mcp-registry) da Docker (Apache-2.0), mas **não faz parte do catálogo distribuído** (`mcp/docker-mcp-catalog:latest` só traz servidores do tipo `image`). Por isso o plugin embarca `mcp/docker-catalog.yaml` e passa `--catalog` ao gateway. Sem isso, `docker mcp gateway run --servers docker` sobe com *0 tools*.
- **Sem Docker Desktop recente:** o gateway roda em Docker Engine/CE — baixe o binário do [docker/mcp-gateway](https://github.com/docker/mcp-gateway) para `~/.docker/cli-plugins/` e, se necessário, exporte `DOCKER_MCP_IN_CONTAINER=1`.
- ⚠️ **Superfície de risco:** a ferramenta monta `/var/run/docker.sock` e executa o Docker CLI com o poder do daemon. É inerente a qualquer MCP de Docker. Remova o servidor do `.mcp.json` se não quiser essa superfície.

---

[← Wiki do Vetor](Home.md)
