const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hydraLive', {
  read: () => ipcRenderer.invoke('live-code:read'),
  write: code => ipcRenderer.invoke('live-code:write', code),
  subscribe: callback => {
    const listener = (_event, code) => callback(code)
    ipcRenderer.on('live-code:changed', listener)
    return () => ipcRenderer.removeListener('live-code:changed', listener)
  }
})

