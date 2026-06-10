const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusmapDesktop', {
  openMain: () => ipcRenderer.invoke('focusmap-desktop:openMain'),
  openExternal: (url) => ipcRenderer.invoke('focusmap-desktop:openExternal', url),
  getWebAuthOrigin: () => ipcRenderer.invoke('focusmap-desktop:getWebAuthOrigin'),
  consumeAuthSession: (nonce, origin) => ipcRenderer.invoke('focusmap-desktop:consumeAuthSession', nonce, origin),
  saveAuthSession: (session) => ipcRenderer.invoke('focusmap-desktop:saveAuthSession', session),
  loadAuthSession: () => ipcRenderer.invoke('focusmap-desktop:loadAuthSession'),
  clearAuthSession: () => ipcRenderer.invoke('focusmap-desktop:clearAuthSession'),
  retryDashboard: () => ipcRenderer.invoke('focusmap-desktop:retryDashboard'),
  openDashboardExternal: () => ipcRenderer.invoke('focusmap-desktop:openDashboardExternal'),
  getAutomationStatus: () => ipcRenderer.invoke('focusmap-desktop:getAutomationStatus'),
  connectAutomation: () => ipcRenderer.invoke('focusmap-desktop:connectAutomation'),
  disconnectAutomation: () => ipcRenderer.invoke('focusmap-desktop:disconnectAutomation'),
  copyText: (text) => ipcRenderer.invoke('focusmap-desktop:copyText', text),
  copyCodexImage: (payload) => ipcRenderer.invoke('focusmap-desktop:copyCodexImage', payload),
  launchCodex: (payload) => ipcRenderer.invoke('focusmap-desktop:launchCodex', payload),
});
