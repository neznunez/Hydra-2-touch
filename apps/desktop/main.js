const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { CodexAppServer } = require('./codex-app-server')

app.commandLine.appendSwitch('high-dpi-support', '1')
app.commandLine.appendSwitch('force_high_performance_gpu')

let studioWindow
let spoutWindow
let spoutOutput
let lastContents = ''
let currentSketchPath = null
let codexServer

const liveArgument = process.argv.find(argument => argument.startsWith('--live-file='))
const appDocuments = path.join(app.getPath('documents'), 'Hydra 2 Touch')
const liveFile = liveArgument
  ? liveArgument.slice('--live-file='.length)
  : path.join(appDocuments, 'hydra-live.js')
const sketchesDir = path.join(appDocuments, 'sketches')

const defaultSketches = [
  {
    name: 'port.js',
    code: `// licensed with CC BY-NC-SA 4.0
// port
// by Marianne Teixido
// https://marianneteixido.github.io/

osc(5, 0.9, 0.001)
  .kaleid([3,4,5,7,8,9,10].fast(0.1))
  .color(0.5, 0.3)
  .colorama(0.4)
  .rotate(0.009, () => Math.sin(time) * -0.001)
  .modulateRotate(o0, () => Math.sin(time) * 0.003)
  .modulate(o0, 0.9)
  .scale(0.9)
  .out(o0)
`
  },
  {
    name: 'feedback.js',
    code: `// feedback study
osc(8, 0.03, 1.2)
  .kaleid(7)
  .modulateRotate(o0, 0.18)
  .colorama(() => time * 0.03)
  .blend(o0, 0.86)
  .out(o0)
`
  },
  {
    name: 'geometry.js',
    code: `// geometry study
shape(6, 0.35, 0.02)
  .repeat(3, 3)
  .modulate(noise(2, 0.08), 0.2)
  .color(0.2, 0.8, 1)
  .diff(osc(12, 0.02, 1.4))
  .out(o0)
`
  }
]

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
}

function writeUtf8(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, String(contents).replace(/\r\n/g, '\n'), { encoding: 'utf8' })
}

function resolveSpoutModule() {
  const filename = 'electron-spout.node'
  return app.isPackaged
    ? path.join(process.resourcesPath, 'native', filename)
    : path.join(__dirname, 'resources', 'native', filename)
}

function getSpoutStatus() {
  return {
    available: fs.existsSync(resolveSpoutModule()),
    active: Boolean(spoutOutput && spoutWindow && !spoutWindow.isDestroyed())
  }
}

function sendSpoutStatus() {
  const status = getSpoutStatus()
  studioWindow?.webContents.send('spout:status', status)
  return status
}

function getCodexServer() {
  if (!codexServer) {
    codexServer = new CodexAppServer({
      cwd: appDocuments,
      onEvent: event => studioWindow?.webContents.send('codex:event', event)
    })
  }
  return codexServer
}

function stopSpoutOutput() {
  const windowToClose = spoutWindow
  spoutWindow = null
  spoutOutput = null
  if (windowToClose && !windowToClose.isDestroyed()) windowToClose.destroy()
  return sendSpoutStatus()
}

function createSpoutOutput() {
  if (getSpoutStatus().active) return sendSpoutStatus()
  createSpoutOutput.loggedGpuFallback = false
  createSpoutOutput.loggedFrameError = false

  const modulePath = resolveSpoutModule()
  if (!fs.existsSync(modulePath)) {
    console.warn(`Spout desativado: modulo nao encontrado em ${modulePath}`)
    return sendSpoutStatus()
  }

  try {
    const { SpoutOutput } = require(modulePath)
    spoutOutput = new SpoutOutput('Hydra 2 Touch')
    spoutWindow = new BrowserWindow({
      width: 1920,
      height: 1080,
      show: false,
      backgroundColor: '#000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
        offscreen: {
          useSharedTexture: true,
          sharedTexturePixelFormat: 'argb',
          deviceScaleFactor: 1
        },
        preload: path.join(__dirname, 'preload.js')
      }
    })
    spoutWindow.webContents.setFrameRate(60)
    spoutWindow.webContents.on('paint', (event, _dirty, image) => {
      if (!spoutOutput) {
        event.texture?.release()
        return
      }
      const sharedTexture = event.texture
      try {
        const textureInfo = sharedTexture?.textureInfo
        const ntHandle = textureInfo?.handle?.ntHandle
        let sent = false

        if (textureInfo && ntHandle) {
          try {
            spoutOutput.updateTexture({
              widgetType: textureInfo.widgetType,
              pixelFormat: textureInfo.pixelFormat,
              sharedTextureHandle: ntHandle
            })
            sent = true
          } catch (gpuError) {
            if (!createSpoutOutput.loggedGpuFallback) {
              createSpoutOutput.loggedGpuFallback = true
              console.warn('Spout GPU falhou; usando copia por CPU.', gpuError.message)
            }
          }
        }

        if (!sent) {
          const size = image.getSize()
          if (size.width > 0 && size.height > 0) {
            spoutOutput.updateFrame(image.toBitmap(), size)
          }
        }
      } catch (error) {
        if (!createSpoutOutput.loggedFrameError) {
          createSpoutOutput.loggedFrameError = true
          console.error('Falha ao enviar frame para o Spout:', error)
        }
      } finally {
        sharedTexture?.release()
      }
    })
    spoutWindow.loadFile(path.join(__dirname, 'index.html'), { query: { output: '1' } })
  } catch (error) {
    console.error('Nao foi possivel iniciar o Spout:', error)
    stopSpoutOutput()
  }

  return sendSpoutStatus()
}

function listSketchFiles() {
  if (!fs.existsSync(sketchesDir)) return []
  return fs.readdirSync(sketchesDir)
    .filter(name => name.toLowerCase().endsWith('.js'))
    .sort((a, b) => a.localeCompare(b, 'pt'))
    .map(name => ({ name, path: path.join(sketchesDir, name) }))
}

function ensureSketchesDir() {
  fs.mkdirSync(sketchesDir, { recursive: true })
  if (listSketchFiles().length === 0) {
    for (const sketch of defaultSketches) {
      writeUtf8(path.join(sketchesDir, sketch.name), sketch.code)
    }
  }
}

function sketchInfo(filePath = currentSketchPath) {
  if (!filePath) return { name: path.basename(liveFile), path: liveFile, saved: false }
  return { name: path.basename(filePath), path: filePath, saved: true }
}

function broadcastLiveCode(code, exceptWebContents) {
  const payload = String(code)
  for (const window of [studioWindow, spoutWindow]) {
    if (!window || window.isDestroyed()) continue
    if (exceptWebContents && window.webContents.id === exceptWebContents.id) continue
    window.webContents.send('live-code:changed', payload)
  }
}

function applySketch(filePath) {
  const code = readUtf8(filePath)
  currentSketchPath = filePath
  lastContents = code
  writeUtf8(liveFile, code)
  broadcastLiveCode(code)
  return { code, ...sketchInfo(filePath) }
}

function ensureLiveFile() {
  fs.mkdirSync(path.dirname(liveFile), { recursive: true })
  if (!fs.existsSync(liveFile)) writeUtf8(liveFile, defaultSketches[0].code)
}

async function saveSketch(code, saveAs) {
  let target = saveAs ? null : currentSketchPath
  if (!target) {
    const result = await dialog.showSaveDialog(studioWindow, {
      title: 'Salvar sketch',
      defaultPath: path.join(sketchesDir, currentSketchPath ? path.basename(currentSketchPath) : 'sketch.js'),
      filters: [{ name: 'Hydra', extensions: ['js'] }]
    })
    if (result.canceled || !result.filePath) return null
    target = result.filePath.endsWith('.js') ? result.filePath : `${result.filePath}.js`
  }
  writeUtf8(target, code)
  currentSketchPath = target
  lastContents = String(code)
  writeUtf8(liveFile, lastContents)
  return sketchInfo(target)
}

async function openSketch() {
  const result = await dialog.showOpenDialog(studioWindow, {
    title: 'Carregar sketch',
    defaultPath: sketchesDir,
    properties: ['openFile'],
    filters: [{ name: 'Hydra', extensions: ['js'] }]
  })
  if (result.canceled || !result.filePaths[0]) return null
  return applySketch(result.filePaths[0])
}

function nextSketch() {
  ensureSketchesDir()
  const files = listSketchFiles()
  if (!files.length) return null
  const currentIndex = files.findIndex(file => file.path === currentSketchPath)
  const next = files[(currentIndex + 1) % files.length]
  return applySketch(next.path)
}

function createWindow() {
  ensureLiveFile()
  ensureSketchesDir()
  lastContents = readUtf8(liveFile)
  studioWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#05070a',
    title: 'Hydra 2 Touch',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })
  studioWindow.loadFile(path.join(__dirname, 'index.html'))
  if (!app.isPackaged) {
    studioWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'F12') {
        studioWindow.webContents.toggleDevTools()
        event.preventDefault()
      }
      if (input.control && !input.alt && !input.meta && input.key.toLowerCase() === 'r') {
        studioWindow.reload()
        event.preventDefault()
      }
    })
  }
  studioWindow.on('closed', () => {
    studioWindow = null
    app.quit()
  })
  createSpoutOutput()

  fs.watchFile(liveFile, { interval: 250 }, () => {
    try {
      const contents = readUtf8(liveFile)
      if (contents !== lastContents) {
        lastContents = contents
        broadcastLiveCode(contents)
      }
    } catch {}
  })
}

ipcMain.handle('live-code:read', () => {
  ensureLiveFile()
  return readUtf8(liveFile)
})

ipcMain.handle('live-code:write', (event, code) => {
  lastContents = String(code)
  writeUtf8(liveFile, lastContents)
  broadcastLiveCode(lastContents, event.sender)
  return true
})

ipcMain.handle('spout:status', () => getSpoutStatus())
ipcMain.handle('spout:set-enabled', (_event, enabled) => {
  return enabled ? createSpoutOutput() : stopSpoutOutput()
})

ipcMain.handle('sketches:info', () => sketchInfo())
ipcMain.handle('sketches:list', () => {
  ensureSketchesDir()
  return listSketchFiles()
})
ipcMain.handle('sketches:save', (_event, code) => saveSketch(code, false))
ipcMain.handle('sketches:save-as', (_event, code) => saveSketch(code, true))
ipcMain.handle('sketches:open', () => openSketch())
ipcMain.handle('sketches:next', () => nextSketch())

ipcMain.handle('codex:status', async () => {
  const server = getCodexServer()
  try {
    await server.start()
  } catch {}
  return server.status
})
ipcMain.handle('codex:login', async () => {
  const result = await getCodexServer().login()
  const authUrl = result?.authUrl || result?.verificationUrl
  if (authUrl) await shell.openExternal(authUrl)
  return {
    type: result?.type,
    userCode: result?.userCode || null,
    opened: Boolean(authUrl)
  }
})
ipcMain.handle('codex:transform-sketch', async (_event, request) => {
  const instruction = String(request?.instruction || '').trim()
  const sketch = String(request?.sketch || '')
  if (!instruction) throw new Error('Digite o que deseja alterar no visual.')
  if (!sketch.trim()) throw new Error('O sketch atual está vazio.')
  if (instruction.length > 4000 || sketch.length > 100000) throw new Error('O pedido ou sketch é grande demais.')
  return getCodexServer().transformSketch(instruction, sketch)
})
ipcMain.handle('codex:new-thread', () => {
  getCodexServer().newThread()
  return true
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  fs.unwatchFile(liveFile)
  codexServer?.stop()
  stopSpoutOutput()
  app.quit()
})
