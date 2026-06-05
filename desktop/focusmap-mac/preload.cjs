const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusmapDesktop', {
  getStatus: () => ipcRenderer.invoke('focusmap-desktop:getStatus'),
  startAgent: () => ipcRenderer.invoke('focusmap-desktop:startAgent'),
  stopAgent: () => ipcRenderer.invoke('focusmap-desktop:stopAgent'),
  startCodexServer: () => ipcRenderer.invoke('focusmap-desktop:startCodexServer'),
  stopCodexServer: () => ipcRenderer.invoke('focusmap-desktop:stopCodexServer'),
  openMain: () => ipcRenderer.invoke('focusmap-desktop:openMain'),
  openExternal: (url) => ipcRenderer.invoke('focusmap-desktop:openExternal', url),
  getWebAuthOrigin: () => ipcRenderer.invoke('focusmap-desktop:getWebAuthOrigin'),
  consumeAuthSession: (nonce, origin) => ipcRenderer.invoke('focusmap-desktop:consumeAuthSession', nonce, origin),
  saveAuthSession: (session) => ipcRenderer.invoke('focusmap-desktop:saveAuthSession', session),
  loadAuthSession: () => ipcRenderer.invoke('focusmap-desktop:loadAuthSession'),
  clearAuthSession: () => ipcRenderer.invoke('focusmap-desktop:clearAuthSession'),
  onLog: (callback) => {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on('focusmap-desktop:log', listener);
    return () => ipcRenderer.removeListener('focusmap-desktop:log', listener);
  },
});
