# Hydra 2 Touch

Aplicativo Windows de live coding com [Hydra](https://hydra.ojack.xyz). O visual vai direto ao TouchDesigner por Spout, na GPU, em **1920 × 1080 a 60 fps**.

Sender Spout: **Hydra 2 Touch**.

## Uso

1. Instale as dependências e abra com `pnpm start`. O `.exe` em `dist/` só inclui estas mudanças depois de `pnpm build`.
2. Escreva Hydra no editor. A execução acontece sozinha após uma pausa na digitação.
3. No TouchDesigner, crie um **Spout In TOP** e em `Sender Name` escolha **Hydra 2 Touch**.

A janela do app mostra o editor por cima do visual. A saída Spout leva só o Hydra, sem código nem botões.

Arquivo ao vivo padrão: `Documentos\Hydra 2 Touch\hydra-live.js`. Qualquer editor que salve esse arquivo atualiza o app. Outro caminho:

```powershell
.\Hydra-2-Touch-1.0.0.exe --live-file=C:\caminho\sketch.js
```

| Atalho | Ação |
| --- | --- |
| `Ctrl + Shift + Enter` | Executar agora |
| `Ctrl + S` | Salvar sketch |
| `Ctrl + O` | Carregar sketch |
| `Shift + F` | Tela cheia |
| `F11` | Mostrar ou ocultar o código |
| `Tab` | Inserir dois espaços |

O ponto **Spout** liga ou desliga o sender. Verde: enviando. Cinza: desligado. Vermelho: módulo nativo ausente.

Salvar e carregar usam `Documentos\Hydra 2 Touch\sketches\`. O shuffle percorre os `.js` dessa pasta e o nome do arquivo aparece ao lado. Na primeira abertura, três sketches de exemplo são criados aí.

## Como funciona

Duas janelas Electron carregam o mesmo `index.html`:

- **Studio** — editor visível, Hydra na resolução da janela.
- **Saída** — 1920 × 1080, invisível, só o canvas Hydra.

O código é o mesmo nos dois lados, sincronizado por IPC e pelo arquivo ao vivo. A janela de saída dispara `paint` a 60 fps. O processo principal manda o frame ao addon C++:

1. Se o Electron entregar uma textura DirectX compartilhada, o addon abre o handle e envia no Spout (`updateTexture`).
2. Se não houver handle, copia o bitmap pela CPU (`updateFrame`).

O addon (`electron-spout.node`) liga Spout2 estaticamente, cria um device D3D11 e publica o sender **Hydra 2 Touch**.

## Estrutura

```text
apps/desktop/                 App Electron (UI, Hydra, empacotamento)
  main.js                     Processo principal, Spout e arquivo ao vivo
  preload.js                  Ponte IPC segura
  renderer.js                 Editor, Hydra e atalhos
  resources/native/           electron-spout.node (não versionado)
native/electron-spout/        Addon N-API C++ / DirectX 11 / Spout
.github/workflows/            Build do módulo nativo no Windows
dist/                         Executável gerado (não versionado)
```

O binário nativo entra em `apps/desktop/resources/native/electron-spout.node`. Sem esse arquivo o app abre, mas o Spout fica desligado.

## Desenvolvimento

Windows x64, Node 22+, pnpm 10, GPU com DirectX 11.

```powershell
pnpm install
pnpm start
```

Não precisa gerar outro `.exe` para testar. O portátil em `dist/` é um snapshot: mudanças no código só entram nele depois de `pnpm build`.

O `pnpm start` abre o Electron em modo desenvolvimento. CSS, HTML e `renderer.js` recarregam com `Ctrl + R`. Mudança em `main.js` ou `preload.js` pede fechar e `pnpm start` de novo. `F12` abre o DevTools.

O módulo nativo precisa estar em `apps/desktop/resources/native/` antes do `start`. O Electron do app é **42.9.1**; o addon tem de ser compilado para essa runtime.

## Módulo nativo

Compilação: CMake.js, vcpkg (`spout2` + `node-addon-api`), MSVC. O Spout é linkado estático; use `CMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL`.

No GitHub: Actions → **Build Electron Spout for Electron 42** → baixe `electron-spout.node` → coloque em `apps/desktop/resources/native/`.

Na máquina, em `native/electron-spout`:

```powershell
npm install --global cmake-js@7.3.1
vcpkg install --triplet x64-windows
cmake-js configure --runtime electron --runtime-version 42.9.1 --arch x64 --CDCMAKE_TOOLCHAIN_FILE=$env:VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake --CDVCPKG_TARGET_TRIPLET=x64-windows --CDCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL
cmake-js build --config Release
Copy-Item build/Release/electron-spout.node ..\..\apps\desktop\resources\native\electron-spout.node
```

Não copie flags de um `cmake-js print-configure` antigo. Os caminhos do Node mudam por máquina.

Base do addon: [electron-spout](https://github.com/reitowo/electron-spout) (Electron 42, textura compartilhada).

## Build do executável

```powershell
pnpm build
```

Gera o portátil `dist/Hydra-2-Touch-1.0.0.exe`, com o `.node` em `resources/native/` do pacote.

## 1.0.0 — 2026-08-18

- App Hydra com editor sobreposto ao visual.
- Saída Spout nativa 1920 × 1080 a 60 fps.
- Arquivo JavaScript compartilhado para edição externa.
- Atalhos de tela cheia e ocultar código.
- Build Windows reproduzível (pnpm + electron-builder + Actions).

## Licença

AGPL-3.0. Hydra Synth: [ojack/hydra-synth](https://github.com/ojack/hydra-synth). Spout: [leadedge/Spout2](https://github.com/leadedge/Spout2).
