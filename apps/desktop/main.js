const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

app.commandLine.appendSwitch('high-dpi-support', '1')
app.commandLine.appendSwitch('force_high_performance_gpu')

let studioWindow
let spoutWindow
let spoutOutput
let lastContents = ''
const liveArgument = process.argv.find(argument => argument.startsWith('--live-file='))
const liveFile = liveArgument
  ? liveArgument.slice('--live-file='.length)
  : path.join(app.getPath('documents'), 'Hydra 2 Touch', 'hydra-live.js')

function resolveSpoutModule() {
  const filename = 'electron-spout.node'
  return app.isPackaged
    ? path.join(process.resourcesPath, 'native', filename)
    : path.join(__dirname, 'resources', 'native', filename)
}

function createSpoutOutput() {
  const modulePath = resolveSpoutModule()
  if (!fs.existsSync(modulePath)) {
    console.warn(`Spout desativado: módulo não encontrado em ${modulePath}`)
    return
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
      const sharedTexture = event.texture
      try {
        const textureInfo = sharedTexture?.textureInfo
        const ntHandle = textureInfo?.handle?.ntHandle

        if (textureInfo && ntHandle) {
          spoutOutput.updateTexture({
            widgetType: textureInfo.widgetType,
            pixelFormat: textureInfo.pixelFormat,
            sharedTextureHandle: ntHandle
          })
        } else {
          spoutOutput.updateFrame(image.getBitmap(), image.getSize())
        }
      } catch (error) {
        console.error('Falha ao enviar frame para o Spout:', error)
      } finally {
        sharedTexture?.release()
      }
    })
    spoutWindow.loadFile('index.html', { query: { output: '1' } })
  } catch (error) {
    console.error('Não foi possível iniciar o Spout:', error)
  }
}

function ensureLiveFile() {
  fs.mkdirSync(path.dirname(liveFile), { recursive: true })
  if (!fs.existsSync(liveFile)) fs.writeFileSync(liveFile, 'osc(10, 0.1, 1.2).out(o0)\n', 'utf8')
}

function createWindow() {
  ensureLiveFile()
  lastContents = fs.readFileSync(liveFile, 'utf8')
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
      preload: path.join(__dirname, 'preload.js')
    }
  })
  studioWindow.loadFile('index.html')
  studioWindow.on('closed', () => {
    studioWindow = null
    app.quit()
  })
  createSpoutOutput()

  fs.watchFile(liveFile, { interval: 250 }, () => {
    try {
      const contents = fs.readFileSync(liveFile, 'utf8')
      if (contents !== lastContents) {
        lastContents = contents
        studioWindow?.webContents.send('live-code:changed', contents)
        spoutWindow?.webContents.send('live-code:changed', contents)
      }
    } catch {}
  })
}

ipcMain.handle('live-code:read', () => {
  ensureLiveFile()
  return fs.readFileSync(liveFile, 'utf8')
})

ipcMain.handle('live-code:write', (_event, code) => {
  lastContents = String(code)
  fs.writeFileSync(liveFile, lastContents, 'utf8')
  return true
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  fs.unwatchFile(liveFile)
  spoutWindow?.destroy()
  spoutOutput = null
  app.quit()
})

