const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

app.commandLine.appendSwitch('high-dpi-support', '1')
app.commandLine.appendSwitch('force_high_performance_gpu')

let studioWindow
let lastContents = ''
const liveArgument = process.argv.find(argument => argument.startsWith('--live-file='))
const liveFile = liveArgument
  ? liveArgument.slice('--live-file='.length)
  : path.join(app.getPath('documents'), 'Codex', '2026-08-14', 'teci', 'hydra-live.js')

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
    title: 'Hydra Studio',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })
  studioWindow.loadFile('index.html')

  fs.watchFile(liveFile, { interval: 250 }, () => {
    try {
      const contents = fs.readFileSync(liveFile, 'utf8')
      if (contents !== lastContents) {
        lastContents = contents
        studioWindow?.webContents.send('live-code:changed', contents)
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
  app.quit()
})

