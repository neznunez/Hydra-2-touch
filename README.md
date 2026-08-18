# Hydra 2 Touch

Aplicativo Windows para live coding com Hydra e envio direto ao TouchDesigner por Spout.

## Versão 1.0

- Editor de código sobreposto ao resultado visual.
- Execução automática durante a edição.
- Botões de play e shuffle.
- `Shift + F` alterna tela cheia; `F11` oculta o código.
- Arquivo JavaScript compartilhado para edição externa em tempo real.
- Sender Spout **Hydra 2 Touch**, 1920 × 1080 a 60 fps.

## Estrutura

```text
apps/desktop/          Aplicativo Electron e interface Hydra
native/electron-spout/ Módulo nativo C++/DirectX/Spout
docs/                  Uso, integração e referências
dist/                  Executáveis gerados (ignorado pelo Git)
```

## Desenvolvimento

```powershell
pnpm install
pnpm start
```

## Build Windows

O workflow `Build Electron Spout for Electron 42` compila o módulo nativo no GitHub Actions. Coloque o artefato `electron-spout.node` em `apps/desktop/resources/native/` e execute:

```powershell
pnpm build
```

Para conectar no TouchDesigner, consulte [docs/TOUCHDESIGNER.md](docs/TOUCHDESIGNER.md).
