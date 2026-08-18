# Hydra 2 Touch

Hydra Studio desktop para live coding visual, com edição de código em tempo real e integração de baixa latência com TouchDesigner por Spout.

## Estrutura

- `app/`: aplicativo Electron/Hydra Studio.
- `native/electron-spout/`: módulo nativo Spout para Electron 42.
- `.github/workflows/`: compilação do módulo nativo em uma máquina Windows do GitHub.

O módulo Spout é compilado na nuvem para evitar a instalação local do Visual Studio Build Tools e do Windows SDK.
