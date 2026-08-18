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

contextBridge.exposeInMainWorld('hydraSpout', {
  status: () => ipcRenderer.invoke('spout:status'),
  setEnabled: enabled => ipcRenderer.invoke('spout:set-enabled', enabled),
  subscribe: callback => {
    const listener = (_event, status) => callback(status)
    ipcRenderer.on('spout:status', listener)
    return () => ipcRenderer.removeListener('spout:status', listener)
  }
})

contextBridge.exposeInMainWorld('hydraSketches', {
  info: () => ipcRenderer.invoke('sketches:info'),
  list: () => ipcRenderer.invoke('sketches:list'),
  save: code => ipcRenderer.invoke('sketches:save', code),
  saveAs: code => ipcRenderer.invoke('sketches:save-as', code),
  open: () => ipcRenderer.invoke('sketches:open'),
  next: () => ipcRenderer.invoke('sketches:next')
})

contextBridge.exposeInMainWorld('hydraCodex', {
  status: () => ipcRenderer.invoke('codex:status'),
  login: () => ipcRenderer.invoke('codex:login'),
  transformSketch: (instruction, sketch) => ipcRenderer.invoke('codex:transform-sketch', { instruction, sketch }),
  newThread: () => ipcRenderer.invoke('codex:new-thread'),
  subscribe: callback => {
    const listener = (_event, update) => callback(update)
    ipcRenderer.on('codex:event', listener)
    return () => ipcRenderer.removeListener('codex:event', listener)
  }
})
