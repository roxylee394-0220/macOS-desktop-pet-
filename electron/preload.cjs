const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopPet', {
  getImportedAssets() {
    return ipcRenderer.invoke('pet-get-imported-assets')
  },
  importModel() {
    return ipcRenderer.invoke('pet-import-model')
  },
  importAnimations() {
    return ipcRenderer.invoke('pet-import-animations')
  },
  deleteImportedAsset(asset) {
    return ipcRenderer.invoke('pet-delete-imported-asset', asset)
  },
  resetImportedAssets() {
    return ipcRenderer.invoke('pet-reset-imported-assets')
  },
  getPetManagerState() {
    return ipcRenderer.invoke('pet-get-manager-state')
  },
  createPet() {
    return ipcRenderer.invoke('pet-create')
  },
  renamePet(petId, name) {
    return ipcRenderer.invoke('pet-rename', { petId, name })
  },
  setPetSize(petId, sizeLevel) {
    return ipcRenderer.invoke('pet-set-size', { petId, sizeLevel })
  },
  setPetsDanceMode(petIds, danceMode) {
    return ipcRenderer.invoke('pet-set-dance-mode', { petIds, danceMode })
  },
  setPetsRoamingEnabled(petIds, enabled) {
    return ipcRenderer.invoke('pet-set-roaming-enabled', { petIds, enabled })
  },
  setPetsEnabled(petIds, enabled) {
    return ipcRenderer.invoke('pet-set-enabled', { petIds, enabled })
  },
  deletePets(petIds) {
    return ipcRenderer.invoke('pet-delete', petIds)
  },
  toggleGroupDance() {
    return ipcRenderer.invoke('pet-toggle-group-dance')
  },
  requestGroupDance(motion) {
    ipcRenderer.send('pet-request-group-dance', motion)
  },
  setDanceCatalog(keys) {
    ipcRenderer.send('pet-set-dance-catalog', keys)
  },
  onPetManagerStateChanged(callback) {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('pet-manager-state', listener)
    return () => ipcRenderer.removeListener('pet-manager-state', listener)
  },
  onPetSizeChanged(callback) {
    const listener = (_event, sizeLevel) => callback(sizeLevel)
    ipcRenderer.on('pet-size-changed', listener)
    return () => ipcRenderer.removeListener('pet-size-changed', listener)
  },
  onGroupDance(callback) {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('pet-group-dance', listener)
    return () => ipcRenderer.removeListener('pet-group-dance', listener)
  },
  onGroupDanceResync(callback) {
    const listener = () => callback()
    ipcRenderer.on('pet-group-dance-resync', listener)
    return () => ipcRenderer.removeListener('pet-group-dance-resync', listener)
  },
  onSpotifyPlaybackChanged(callback) {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('spotify-playback-state', listener)
    return () => ipcRenderer.removeListener('spotify-playback-state', listener)
  },
  beginDrag(screenX, screenY) {
    return ipcRenderer.sendSync('pet-drag-start', { screenX, screenY })
  },
  endDrag() {
    ipcRenderer.send('pet-drag-end')
  },
  setMouseInteractive(interactive) {
    ipcRenderer.send('pet-set-mouse-interactive', interactive)
  },
  setVisibleBounds(bounds) {
    ipcRenderer.send('pet-visible-bounds', bounds)
  },
  setRoaming(enabled) {
    ipcRenderer.send('pet-set-roaming', enabled)
  },
  onRoamDirectionChanged(callback) {
    const listener = (_event, direction) => callback(direction)
    ipcRenderer.on('pet-roam-direction', listener)
    return () => ipcRenderer.removeListener('pet-roam-direction', listener)
  },
  onRoamTargetReached(callback) {
    const listener = () => callback()
    ipcRenderer.on('pet-roam-target-reached', listener)
    return () => ipcRenderer.removeListener('pet-roam-target-reached', listener)
  },
})
