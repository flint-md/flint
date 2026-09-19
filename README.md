<div align="center">
  <img src="public/flint-logo.png" alt="Flint logo" style="width: 15%; height: auto;">
  <br>

 ![Flint](https://img.shields.io/badge/version-2.0.2-amber?style=flat-square)
  ![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
  ![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=flat-square)
![PRs](https://img.shields.io/badge/PRs-welcome-blueviolet?style=flat-square)

</div>

- Flint is a secure, local-first knowledge base with markdown notes, linked-note navigation, a visual graph, an infinite canvas, and optional AI assistance through local services.

https://github.com/user-attachments/assets/8f570dfe-9b1c-4076-8c05-b6f0e0d29be1

## Install

Linux and macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/flint-md/flint/main/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/flint-md/flint/main/install.ps1 | iex
```

The installer automatically checks for official prebuilt desktop binaries (AppImage/exe) for instant 5-second installation. If binaries are not available for the target platform or when running from source, it configures an optimized desktop runtime with native shell icons and launcher integration.

Requirements:

- Node.js 18 or newer (only needed when building from source or running in dev mode)
- Python 3 (optional, for the local AI agent)
- Ollama for local model chat, for example `ollama pull llama3.2`

## Features

### Notes

- Markdown editor with live preview
- Wiki links with `[[Note Name]]`
- Tags with `#tag`
- Auto-save
- Split editor and preview mode
- Formatting toolbar
- Daily notes

### Canvas

- Infinite board for visual thinking
- Text cards, note cards, image cards, and frame groups
- Drag-to-connect lines with color controls
- Auto-rendered links between note cards
- Zoom, pan, undo, redo, and card context menus

### Graph

- Interactive force-directed note graph
- Node sizing by connection count
- Drag, zoom, pan, search, and depth filtering
- Curved edges between connected notes

### AI Agent

- [ ] Optional local Python agent
- [ ] Uses your notes as memory
- [ ] Can read graph connections for more context
- [ ] currently Works with Ollama only
- [ ] Can search Wikipedia when internet access is enabled
- [ ] Note-editing actions for supported requests

### Local First

- Notes stay on your device
- Vault data is stored locally
- Folder vault support for local workspaces
- No cloud account required

>## Development
>```
>git clone --single-branch --branch <branch-name> https://github.com/flint-md/flint.git
>```

Installer, update, and uninstaller scripts:

- `install.sh`: Linux/macOS installer supporting prebuilt binaries, fast local installs, and `curl ... | bash`.
- `install.ps1`: Windows installer supporting prebuilt binaries, fast local installs, and `irm ... | iex`.
- `install.bat`: Quick-run Windows wrapper for `install.ps1`.
- `update.sh` / `update.ps1`: Updates Flint to the latest release while preserving your local vaults and notes.
- `update.bat`: Quick-run Windows wrapper for `update.ps1`.
- `uninstall.sh`: Uninstalls Flint on Linux/macOS. Run via `flint-uninstall` from terminal or `~/.flint/uninstall.sh`.
- `uninstall.ps1` / `uninstall.bat`: Uninstalls Flint on Windows. Run via `flint-uninstall` from terminal or `%USERPROFILE%\.flint\uninstall.bat`.

### Uninstall

To uninstall Flint anytime from terminal:

```bash
flint-uninstall
```

Or run via one-liner:

Linux and macOS:
```bash
curl -fsSL https://raw.githubusercontent.com/flint-md/flint/main/uninstall.sh | bash
```

Windows PowerShell:
```powershell
irm https://raw.githubusercontent.com/flint-md/flint/main/uninstall.ps1 | iex
```

## Aim

- [ ] Local models can use your notes, graph links, and optional internet search to answer questions.
- [ ] The Flint agent can update notes when you ask it to perform supported edit actions.
- [ ] Flint can manage notes and task workflows inside your selected vault.

>[!note]
> This project is under active development. Issues and pull requests are welcome, especially for desktop packaging, vault reliability, AI tools, canvas workflows, and accessibility.

## Star History

[![RepoStars](https://repostars.dev/api/embed?repo=flint-md%2Fflint&theme=dark)](https://repostars.dev/?repos=flint-md%2Fflint&theme=dark)
