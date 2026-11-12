# Finanças da Casa — Aplicação de Ambiente de Trabalho (Desktop)

A **versão desktop** do Finanças da Casa é uma aplicação nativa, **100% offline**, construída com **Rust + Tauri 2 + SQLite**. Reutiliza integralmente o frontend da versão web (mesmos componentes, design e funcionalidades), mas passa a correr como um programa normal do computador — sem browser, sem servidor, sem conta e sem Internet.

## Arquitetura

```
┌──────────────────────────────────────────────────────────┐
│  Janela nativa (Tauri 2 / WebKitGTK)                     │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Frontend — o mesmo React app da versão web        │  │
│  │  (bundled localmente com Vite, fontes incluídas)   │  │
│  │                                                    │  │
│  │  fetch("/api/…")  ──►  shim (desktop/fetch-shim.ts)│  │
│  └───────────────────────┬────────────────────────────┘  │
│                          │ invoke() — IPC local          │
│  ┌───────────────────────▼────────────────────────────┐  │
│  │  Backend Rust (src-tauri/src)                      │  │
│  │  • SQLite em cents inteiros (sem erros de vírgula) │  │
│  │  • Todas as validações e cálculos financeiros      │  │
│  │  • Migrations com PRAGMA user_version              │  │
│  │  • Backups/restauro/CSV com diálogos nativos       │  │
│  │  • Menu nativo (Ficheiro/Editar/Ver/Definições)    │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**Privacidade por construção:** a base de dados fica na pasta de dados da aplicação do sistema operativo (ex.: `~/.local/share/app.financas.casa/` no Linux, `%APPDATA%/app.financas.casa` no Windows, `~/Library/Application Support/app.financas.casa` no macOS). Nenhum dado sai do computador; a aplicação não faz pedidos de rede (os únicos URLs no bundle são mensagens de erro internas do React, nunca acedidos).

## Funcionalidades específicas da versão desktop

| Funcionalidade | Onde |
| --- | --- |
| Importar dados da versão web (ficheiro `custom.db`) | Primeira utilização (diálogo) ou menu **Ficheiro → Importar dados da versão web…** |
| Backup completo da base de dados (snapshot `VACUUM INTO`) | **Ficheiro → Novo backup…** (Ctrl+B) |
| Restaurar backup (valida o ficheiro + backup automático do estado atual antes de substituir) | **Ficheiro → Restaurar backup…** (Ctrl+R) |
| Exportar CSV (ponto e vírgula, decimais com vírgula, datas DD/MM/AAAA — abre no Excel PT) | **Ficheiro → Exportar CSV…** (Ctrl+E) |
| Zoom da interface / ecrã inteiro | **Ver** |
| Mudar de idioma (PT/EN) e tema claro/escuro | **Definições** |
| Versão da aplicação | **Ajuda → Acerca de** |

Backups automáticos são criados em `<pasta de dados>/backups/` antes de migrações, restauros e importações (mantidos os 20 mais recentes).

## Requisitos

- **Linux:** Debian 12+/Ubuntu 22.04+ com `libwebkit2gtk-4.1-0` e `libgtk-3-0` (instalados automaticamente pelo .deb)
- **Windows 10/11:** WebView2 (instalado automaticamente pelo instalador)
- **macOS 10.15+**

## Instalar (Linux — Debian/Ubuntu)

```bash
sudo apt install ./Finanças\ da\ Casa_1.0.0_amd64.deb
```

A aplicação fica disponível no menu de aplicações como **"Finanças da Casa"** (ou corra `financas-da-casa`).

## Compilar a partir do código-fonte

### Pré-requisitos (todas as plataformas)

- [Rust](https://rustup.rs) 1.77+ (`rustup default stable`)
- [Bun](https://bun.sh) (ou Node 18+)
- [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/):
  - **Linux:** `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
  - **Windows:** Visual Studio Build Tools + WebView2
  - **macOS:** Xcode Command Line Tools

### Comandos

```bash
# 1. dependências de frontend
bun install

# 2. gerar os ícones (apenas se alterares desktop/icon-source.png)
bun run desktop:icon

# 3. instalar o package installável + arrancar em modo de desenvolvimento
bun run tauri dev          # janela nativa com hot-reload do frontend

# 4. construir os instaladores
bun run tauri build
```

Resultados em `src-tauri/target/release/bundle/`:

| Plataforma | Ficheiros |
| --- | --- |
| Linux | `deb/Finanças da Casa_1.0.0_amd64.deb` · `appimage/*.AppImage` |
| Windows | `msi/*.msi` e/ou `nsis/*.exe` |
| macOS | `dmg/*.dmg` e `macos/*.app` |

> Cada instalador tem de ser gerado no respetivo sistema operativo (limitação normal do empacotamento desktop). A configuração do projeto (`tauri.conf.json`) já contempla as três plataformas — basta correr `bun run tauri build` em cada uma.

### Testes de paridade (Rust)

```bash
cd src-tauri && cargo test
```

Validam que o backend Rust produz **exatamente** os mesmos resultados que a API web original: divisão partilhada (`normalizePaidSplit`), percentagens derivadas, arredondamentos em cêntimos, regras de validação e cálculo do resumo mensal.

## Notas técnicas

- **Dinheiro em cêntimos inteiros** na base de dados (INTEGER) — zero erros de arredondamento de vírgula flutuante; a conversão para euros acontece apenas na fronteira JSON, com a mesma semântica `Math.round` do JS (testado).
- **O frontend não foi reescrito**: o shim `desktop/fetch-shim.ts` interceta os `fetch("/api/…")` e encaminha-os por IPC para os comandos Rust, mantendo o contrato JSON idêntico ao da API web.
- **Migrações:** `PRAGMA user_version` + SQL embutido; backup automático antes de qualquer migração numa base de dados existente.
- **Sem telemetria, sem analytics, sem sincronização** — verificação: nenhum URL externo no bundle; nenhuma chamada de rede em execução normal.
