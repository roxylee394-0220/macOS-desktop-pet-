import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, net, protocol, screen, session } from 'electron'

app.commandLine.appendSwitch('disable-features', 'MacCatapLoopbackAudioForScreenShare')
protocol.registerSchemesAsPrivileged([{
  scheme: 'pet-assets',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}])

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) {
    const profile = petRegistry.pets[0] ?? emptyPetProfile()
    if (!petRegistry.pets.length) petRegistry.pets.push(profile)
    profile.enabled = true
    writePetRegistry()
    createPetWindow(profile)
    return
  }
  if (window.isMinimized()) window.restore()
  ensureWindowVisible(window)
  window.focus()
})

const VITE_DEV_SERVER_URL = 'http://127.0.0.1:5173'
const PRELOAD_PATH = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const RENDERER_PATH = fileURLToPath(new URL('../dist/index.html', import.meta.url))
const SPOTIFY_STATE_SCRIPT = [
  'if application "Spotify" is running then',
  'tell application "Spotify" to return player state as text',
  'end if',
  'return "stopped"',
]
const roamingWindows = new Map()
const dragOffsets = new Map()
const visibleBoundsByWebContents = new Map()
const petWindows = new Map()
const petIdByWebContents = new Map()
const danceCatalogsByPetId = new Map()
const VERTICAL_EDGE_OVERHANG = 0.15
const MAX_PETS = 5
const DEFAULT_PET_ID = 'default'
const DEFAULT_PET_SIZE = 5
let assetMutationQueue = Promise.resolve()
let petRegistry = {
  version: 1,
  groupDanceEnabled: false,
  pets: [],
}
let registryWriteQueue = Promise.resolve()
let spotifyPollTimer = null
let spotifyPollInFlight = false
let lastSpotifyState = null

function queueAssetMutation(operation) {
  const result = assetMutationQueue.then(operation, operation)
  assetMutationQueue = result.catch(() => {})
  return result
}

function petsDirectory() {
  return join(app.getPath('userData'), 'Pets')
}

function registryPath() {
  return join(petsDirectory(), 'registry.json')
}

function importedAssetsDirectory(petId) {
  return join(petsDirectory(), petId)
}

function emptyPetProfile(index = 0) {
  return {
    id: `pet-${randomUUID()}`,
    name: `桌宠 ${index + 1}`,
    enabled: true,
    builtIn: false,
    sizeLevel: DEFAULT_PET_SIZE,
    danceMode: 'solo',
    roamingEnabled: false,
    bounds: null,
  }
}

function sanitizeBounds(bounds) {
  if (
    !bounds
    || !Number.isFinite(bounds.x)
    || !Number.isFinite(bounds.y)
    || !Number.isFinite(bounds.width)
    || !Number.isFinite(bounds.height)
  ) return null
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: 380,
    height: 600,
  }
}

function sanitizePetProfile(profile, index) {
  const fallbackId = `pet-${index + 1}`
  const id = typeof profile?.id === 'string' && /^[a-z0-9-]{1,80}$/i.test(profile.id)
    ? profile.id
    : fallbackId
  const fallbackName = `桌宠 ${index + 1}`
  return {
    id,
    name: typeof profile?.name === 'string' && profile.name.trim()
      ? profile.name.trim().slice(0, 40)
      : fallbackName,
    enabled: profile?.enabled !== false,
    builtIn: false,
    sizeLevel: Number.isInteger(profile?.sizeLevel)
      ? Math.max(0, Math.min(10, profile.sizeLevel))
      : DEFAULT_PET_SIZE,
    danceMode: ['off', 'solo', 'group'].includes(profile?.danceMode)
      ? profile.danceMode
      : 'solo',
    roamingEnabled: typeof profile?.roamingEnabled === 'boolean'
      ? profile.roamingEnabled
      : false,
    bounds: sanitizeBounds(profile?.bounds),
  }
}

async function readPetRegistry() {
  try {
    const saved = JSON.parse(await readFile(registryPath(), 'utf8'))
    const seen = new Set()
    const pets = (Array.isArray(saved.pets) ? saved.pets : [])
      .filter((profile) => profile?.id !== DEFAULT_PET_ID)
      .slice(0, MAX_PETS)
      .map(sanitizePetProfile)
      .filter((profile) => {
        if (seen.has(profile.id)) return false
        seen.add(profile.id)
        return true
      })
    const restoredPets = pets.length ? pets.slice(0, MAX_PETS) : [emptyPetProfile()]
    if (!restoredPets.some(({ enabled }) => enabled)) restoredPets[0].enabled = true
    return {
      version: 1,
      groupDanceEnabled: saved.groupDanceEnabled === true,
      pets: restoredPets,
    }
  } catch {
    return {
      version: 1,
      groupDanceEnabled: false,
      pets: [emptyPetProfile()],
    }
  }
}

function writePetRegistry() {
  const snapshot = JSON.stringify(petRegistry, null, 2)
  registryWriteQueue = registryWriteQueue
    .catch(() => {})
    .then(async () => {
      await mkdir(petsDirectory(), { recursive: true })
      await writeFile(registryPath(), snapshot)
    })
  return registryWriteQueue
}

function getPetProfile(petId) {
  return petRegistry.pets.find(({ id }) => id === petId) ?? null
}

function petIdForEvent(event) {
  return petIdByWebContents.get(event.sender.id) ?? null
}

async function readImportedManifest(petId) {
  try {
    return JSON.parse(await readFile(join(importedAssetsDirectory(petId), 'manifest.json'), 'utf8'))
  } catch {
    return { model: null, animations: [] }
  }
}

async function writeImportedManifest(petId, manifest) {
  await mkdir(importedAssetsDirectory(petId), { recursive: true })
  await writeFile(
    join(importedAssetsDirectory(petId), 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  )
}

function rendererAssetManifest(petId, manifest) {
  return {
    modelUrl: manifest.model ? `pet-assets://${petId}/model.vrm` : null,
    modelName: manifest.model ? (manifest.modelName ?? manifest.model) : null,
    animations: (manifest.animations ?? []).map((name) => ({
      name,
      url: `pet-assets://${petId}/animations/${encodeURIComponent(name)}`,
    })),
  }
}

function getVisibleBounds(window) {
  const bounds = window.getBounds()
  const fallback = {
    left: 0,
    top: 0,
    right: bounds.width,
    bottom: bounds.height,
  }
  const visible = visibleBoundsByWebContents.get(window.webContents.id)
  if (
    !visible
    || !Number.isFinite(visible.left)
    || !Number.isFinite(visible.top)
    || !Number.isFinite(visible.right)
    || !Number.isFinite(visible.bottom)
    || visible.right <= visible.left
    || visible.bottom <= visible.top
  ) return fallback
  return visible
}

function stopWindowDrag(webContentsId) {
  const state = dragOffsets.get(webContentsId)
  if (state?.timer) clearInterval(state.timer)
  dragOffsets.delete(webContentsId)
}

function safelySetWindowBounds(window, x, y) {
  if (window.isDestroyed()) return false
  const safeX = Math.max(-2147483648, Math.min(2147483647, Math.round(x)))
  const safeY = Math.max(-2147483648, Math.min(2147483647, Math.round(y)))
  if (!Number.isSafeInteger(safeX) || !Number.isSafeInteger(safeY)) return false
  try {
    // Only the position changes while roaming or dragging. On macOS,
    // repeatedly applying partial bounds to a transparent frameless window
    // can briefly recreate its surface when it crosses onto another display.
    window.setPosition(safeX, safeY, false)
    return true
  } catch (error) {
    console.error(`Ignored invalid window bounds (${safeX}, ${safeY}):`, error)
    return false
  }
}

function clampWindowPosition(window, x, y, workArea = null) {
  const bounds = window.getBounds()
  const targetArea = workArea ?? screen.getDisplayMatching(bounds).workArea
  const visible = getVisibleBounds(window)
  const safeX = Number.isFinite(x) ? x : bounds.x
  const safeY = Number.isFinite(y) ? y : bounds.y
  const visibleHeight = visible.bottom - visible.top
  const verticalOverhang = visibleHeight * VERTICAL_EDGE_OVERHANG
  return {
    x: Math.round(Math.max(targetArea.x - visible.left, Math.min(safeX, targetArea.x + targetArea.width - visible.right))),
    y: Math.round(Math.max(
      targetArea.y - visible.top - verticalOverhang,
      Math.min(safeY, targetArea.y + targetArea.height - visible.bottom + verticalOverhang),
    )),
  }
}

function ensureWindowVisible(window, preferredBounds = null) {
  if (!window || window.isDestroyed()) return
  const bounds = preferredBounds ?? window.getBounds()
  const safeX = Math.max(-2147483000, Math.min(2147483000, Math.round(bounds.x)))
  const safeY = Math.max(-2147483000, Math.min(2147483000, Math.round(bounds.y)))
  const display = screen.getDisplayNearestPoint({
    x: safeX + Math.round(bounds.width / 2),
    y: safeY + Math.round(bounds.height / 2),
  })
  const position = clampWindowPosition(window, safeX, safeY, display.workArea)
  safelySetWindowBounds(window, position.x, position.y)
  window.show()
}

function randomRoamingTarget(window) {
  const displays = screen.getAllDisplays()
  const display = displays[Math.floor(Math.random() * displays.length)]
  // Use the whole display vertically, including the menu-bar/dock region.
  // The transparent pet window is always-on-top and can safely occupy it.
  const area = display.bounds
  const visible = getVisibleBounds(window)
  const verticalOverhang = (visible.bottom - visible.top) * VERTICAL_EDGE_OVERHANG
  const minimumX = area.x - visible.left
  const maximumX = area.x + area.width - visible.right
  const minimumY = area.y - visible.top - verticalOverhang
  const maximumY = area.y + area.height - visible.bottom + verticalOverhang
  return {
    x: minimumX + Math.random() * Math.max(1, maximumX - minimumX),
    y: minimumY + Math.random() * Math.max(1, maximumY - minimumY),
    workArea: area,
  }
}

function stopWindowRoaming(window) {
  const state = roamingWindows.get(window)
  if (state?.timer) clearInterval(state.timer)
  roamingWindows.delete(window)
}

function startWindowRoaming(window) {
  stopWindowRoaming(window)
  const [startX, startY] = window.getPosition()
  const firstTarget = randomRoamingTarget(window)
  const state = {
    direction: Math.sign(firstTarget.x - startX) || 1,
    target: firstTarget,
    preciseX: startX,
    preciseY: startY,
    phase: 0,
    lastTick: performance.now(),
    timer: null,
  }
  window.webContents.send('pet-roam-direction', state.direction)
  state.timer = setInterval(() => {
    if (window.isDestroyed()) return stopWindowRoaming(window)
    const x = state.preciseX
    const y = state.preciseY
    const now = performance.now()
    const deltaSeconds = Math.min(Math.max((now - state.lastTick) / 1000, 1 / 120), 0.05)
    state.lastTick = now

    let deltaX = state.target.x - x
    let deltaY = state.target.y - y
    const distance = Math.hypot(deltaX, deltaY)
    if (distance < 4) {
      stopWindowRoaming(window)
      window.webContents.send('pet-roam-target-reached')
      return
    }
    const direction = Math.sign(deltaX) || state.direction
    if (direction !== state.direction) {
      state.direction = direction
      window.webContents.send('pet-roam-direction', state.direction)
    }
    const targetDistance = Math.max(Math.hypot(deltaX, deltaY), 0.001)
    state.phase += deltaSeconds * 7
    const pixelsPerSecond = 62 + Math.abs(Math.sin(state.phase)) * 22
    const step = Math.min(pixelsPerSecond * deltaSeconds, targetDistance)
    state.preciseX = x + deltaX / targetDistance * step
    state.preciseY = y + deltaY / targetDistance * step
    const next = {
      x: Math.round(state.preciseX),
      y: Math.round(state.preciseY),
    }
    const [windowX, windowY] = window.getPosition()
    if (
      Number.isFinite(next.x)
      && Number.isFinite(next.y)
      && (next.x !== windowX || next.y !== windowY)
    ) safelySetWindowBounds(window, next.x, next.y)
  }, 33)
  roamingWindows.set(window, state)
  console.log(`Desktop roaming started: ${state.direction < 0 ? 'left' : 'right'}`)
}

ipcMain.on('pet-drag-start', (event, { screenX, screenY }) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) {
    event.returnValue = false
    return
  }
  stopWindowRoaming(window)
  window.focus()
  const senderId = event.sender.id
  const [x, y] = window.getPosition()
  stopWindowDrag(senderId)
  const state = {
    offsetX: screenX - x,
    offsetY: screenY - y,
    timer: null,
  }
  state.timer = setInterval(() => {
    if (window.isDestroyed()) return stopWindowDrag(senderId)
    const cursor = screen.getCursorScreenPoint()
    const movementArea = screen.getDisplayNearestPoint(cursor).bounds
    const next = clampWindowPosition(
      window,
      cursor.x - state.offsetX,
      cursor.y - state.offsetY,
      movementArea,
    )
    safelySetWindowBounds(window, next.x, next.y)
  }, 16)
  dragOffsets.set(senderId, state)
  event.returnValue = true
})

ipcMain.on('pet-drag-end', (event) => {
  stopWindowDrag(event.sender.id)
})

ipcMain.on('pet-set-mouse-interactive', (event, interactive) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || typeof interactive !== 'boolean') return
  if (interactive) window.setIgnoreMouseEvents(false)
  else window.setIgnoreMouseEvents(true, { forward: true })
})

ipcMain.on('pet-visible-bounds', (event, bounds) => {
  if (
    bounds
    && Number.isFinite(bounds.left)
    && Number.isFinite(bounds.top)
    && Number.isFinite(bounds.right)
    && Number.isFinite(bounds.bottom)
    && bounds.right > bounds.left
    && bounds.bottom > bounds.top
  ) visibleBoundsByWebContents.set(event.sender.id, bounds)
})

ipcMain.on('pet-set-roaming', (event, enabled) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return
  console.log(`Desktop roaming request: ${enabled ? 'start' : 'stop'}`)
  if (enabled) startWindowRoaming(window)
  else stopWindowRoaming(window)
})

ipcMain.handle('pet-get-imported-assets', async (event) => {
  const petId = petIdForEvent(event)
  const profile = getPetProfile(petId)
  if (!profile) throw new Error('Unknown pet window')
  if (profile.builtIn) return { builtIn: true, modelUrl: null, modelName: 'model.vrm', animations: [] }
  return {
    builtIn: false,
    ...rendererAssetManifest(petId, await readImportedManifest(petId)),
  }
})

async function showPetOpenDialog(event, options) {
  const parentWindow = event.sender.isDestroyed()
    ? null
    : BrowserWindow.fromWebContents(event.sender)

  if (!parentWindow || parentWindow.isDestroyed()) {
    return dialog.showOpenDialog(options)
  }

  const wasAlwaysOnTop = parentWindow.isAlwaysOnTop()
  stopWindowDrag(event.sender.id)
  parentWindow.setIgnoreMouseEvents(false)
  if (wasAlwaysOnTop) parentWindow.setAlwaysOnTop(false)
  if (parentWindow.isMinimized()) parentWindow.restore()
  parentWindow.show()
  parentWindow.focus()

  try {
    return await dialog.showOpenDialog(parentWindow, options)
  } finally {
    if (!parentWindow.isDestroyed() && wasAlwaysOnTop) {
      parentWindow.setAlwaysOnTop(true, 'floating')
    }
  }
}

ipcMain.handle('pet-import-model', async (event) => queueAssetMutation(async () => {
  const petId = petIdForEvent(event)
  const profile = getPetProfile(petId)
  if (!profile || profile.builtIn) throw new Error('The built-in pet assets cannot be replaced')
  const result = await showPetOpenDialog(event, {
    title: '选择 VRM 模型',
    properties: ['openFile'],
    filters: [{ name: 'VRM Model', extensions: ['vrm'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  if (extname(result.filePaths[0]).toLowerCase() !== '.vrm') {
    throw new Error('Selected model is not a .vrm file')
  }
  const directory = importedAssetsDirectory(petId)
  await mkdir(directory, { recursive: true })
  await copyFile(result.filePaths[0], join(directory, 'model.vrm'))
  const manifest = await readImportedManifest(petId)
  manifest.model = 'model.vrm'
  manifest.modelName = basename(result.filePaths[0])
  await writeImportedManifest(petId, manifest)
  return rendererAssetManifest(petId, manifest)
}))

ipcMain.handle('pet-import-animations', async (event) => queueAssetMutation(async () => {
  const petId = petIdForEvent(event)
  const profile = getPetProfile(petId)
  if (!profile || profile.builtIn) throw new Error('The built-in pet assets cannot be replaced')
  const result = await showPetOpenDialog(event, {
    title: '选择一个或多个 VRMA 动作',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'VRM Animation', extensions: ['vrma'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const animationDirectory = join(importedAssetsDirectory(petId), 'animations')
  await mkdir(animationDirectory, { recursive: true })
  const manifest = await readImportedManifest(petId)
  const names = new Set(manifest.animations ?? [])
  for (const source of result.filePaths) {
    if (extname(source).toLowerCase() !== '.vrma') continue
    const originalName = basename(source)
    const stem = originalName
      .slice(0, -extname(originalName).length)
      .normalize('NFC')
      .replace(/[\u0000-\u001f\u007f/\\:]/g, '_')
      .trim()
      .slice(0, 120) || 'motion'
    const targetName = `${stem}.vrma`
    // Re-importing the same filename updates that action instead of creating
    // an ever-growing list of numbered duplicates.
    await copyFile(source, join(animationDirectory, targetName))
    names.add(targetName)
  }
  manifest.animations = [...names]
  await writeImportedManifest(petId, manifest)
  return rendererAssetManifest(petId, manifest)
}))

ipcMain.handle('pet-delete-imported-asset', async (event, asset) => queueAssetMutation(async () => {
  const petId = petIdForEvent(event)
  const profile = getPetProfile(petId)
  if (!profile || profile.builtIn) return false
  const manifest = await readImportedManifest(petId)
  const type = asset?.type
  const name = typeof asset?.name === 'string' ? asset.name : ''
  if (type === 'model' && !manifest.model) return false
  if (
    type === 'animation'
    && (
      !name
      || basename(name) !== name
      || !(manifest.animations ?? []).includes(name)
    )
  ) return false
  if (type !== 'model' && type !== 'animation') return false

  const owner = BrowserWindow.fromWebContents(event.sender)
  const displayName = type === 'model'
    ? (manifest.modelName ?? '当前 VRM 模型')
    : name
  const options = {
    type: 'warning',
    title: '删除选中文件',
    message: `确定删除“${displayName}”吗？`,
    detail: '只删除桌宠保存的副本，不会删除原来位置的文件。',
    buttons: ['取消', '删除'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
  const result = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options)
  if (result.response !== 1) return false

  if (type === 'model') {
    await rm(join(importedAssetsDirectory(petId), 'model.vrm'), { force: true })
    manifest.model = null
    manifest.modelName = null
  } else {
    await rm(join(importedAssetsDirectory(petId), 'animations', name), { force: true })
    manifest.animations = (manifest.animations ?? []).filter((candidate) => candidate !== name)
  }
  await writeImportedManifest(petId, manifest)
  return true
}))

ipcMain.handle('pet-reset-imported-assets', async (event) => queueAssetMutation(async () => {
  const petId = petIdForEvent(event)
  const profile = getPetProfile(petId)
  if (!profile || profile.builtIn) return false
  const manifest = await readImportedManifest(petId)
  if (!manifest.model && (manifest.animations ?? []).length === 0) return false

  const owner = BrowserWindow.fromWebContents(event.sender)
  const options = {
    type: 'warning',
    title: '初始化桌宠',
    message: '确定删除桌宠保存的全部 VRM 和 VRMA 副本吗？',
    detail: '不会删除原来位置的文件。初始化后需要重新导入模型和动作。',
    buttons: ['取消', '初始化'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
  const result = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options)
  if (result.response !== 1) return false

  await rm(importedAssetsDirectory(petId), { recursive: true, force: true })
  return true
}))

function currentGroupLeaderId() {
  return petRegistry.pets.find(({ id, enabled, danceMode }) => (
    enabled && danceMode === 'group' && petWindows.has(id)
  ))?.id ?? null
}

function currentGroupMemberIds() {
  return petRegistry.pets
    .filter(({ id, enabled, danceMode }) => (
      enabled && danceMode === 'group' && petWindows.has(id)
    ))
    .map(({ id }) => id)
}

function currentGroupCommonDanceKeys() {
  const memberIds = currentGroupMemberIds()
  if (!memberIds.length) return []
  const catalogs = memberIds.map((id) => danceCatalogsByPetId.get(id))
  if (catalogs.some((catalog) => !catalog)) return []
  return [...catalogs.slice(1).reduce(
    (common, catalog) => new Set([...common].filter((key) => catalog.has(key))),
    new Set(catalogs[0]),
  )]
}

function petManagerState(currentPetId = null) {
  return {
    currentPetId,
    maxPets: MAX_PETS,
    groupLeaderId: currentGroupLeaderId(),
    groupCommonDanceKeys: currentGroupCommonDanceKeys(),
    pets: petRegistry.pets.map(({
      id, name, enabled, builtIn, sizeLevel, danceMode, roamingEnabled,
    }) => ({
      id,
      name,
      enabled,
      builtIn,
      sizeLevel,
      danceMode,
      roamingEnabled,
      running: petWindows.has(id),
    })),
  }
}

function broadcastPetManagerState() {
  for (const [petId, window] of petWindows) {
    if (!window.isDestroyed()) {
      window.webContents.send('pet-manager-state', petManagerState(petId))
    }
  }
}

function scheduleGroupDanceResync() {
  const leaderId = currentGroupLeaderId()
  if (!leaderId) return
  setTimeout(() => {
    const currentLeaderId = currentGroupLeaderId()
    const leaderWindow = currentLeaderId ? petWindows.get(currentLeaderId) : null
    if (leaderWindow && !leaderWindow.isDestroyed()) {
      leaderWindow.webContents.send('pet-group-dance-resync')
    }
  }, 100)
}

function normalizePetIds(ids) {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids)]
    .filter((id) => typeof id === 'string' && getPetProfile(id))
}

ipcMain.handle('pet-get-manager-state', async (event) => {
  return petManagerState(petIdForEvent(event))
})

ipcMain.on('pet-set-dance-catalog', (event, keys) => {
  const petId = petIdForEvent(event)
  if (!petId || !Array.isArray(keys)) return
  danceCatalogsByPetId.set(petId, new Set(
    keys
      .filter((key) => typeof key === 'string' && /^[a-z0-9]{1,160}$/.test(key))
      .slice(0, 500),
  ))
  broadcastPetManagerState()
  scheduleGroupDanceResync()
})

ipcMain.handle('pet-create', async (event) => {
  if (petRegistry.pets.length >= MAX_PETS) {
    throw new Error(`最多只能同时管理 ${MAX_PETS} 个桌宠`)
  }
  const id = `pet-${randomUUID()}`
  const profile = sanitizePetProfile({
    id,
    name: `桌宠 ${petRegistry.pets.length + 1}`,
    enabled: true,
    builtIn: false,
  }, petRegistry.pets.length)
  petRegistry.pets.push(profile)
  await writePetRegistry()
  createPetWindow(profile)
  broadcastPetManagerState()
  return petManagerState(petIdForEvent(event))
})

ipcMain.handle('pet-rename', async (_event, { petId, name } = {}) => {
  const profile = getPetProfile(petId)
  const normalizedName = typeof name === 'string' ? name.trim().slice(0, 40) : ''
  if (!profile || !normalizedName) return false
  profile.name = normalizedName
  await writePetRegistry()
  broadcastPetManagerState()
  return true
})

ipcMain.handle('pet-set-size', async (_event, { petId, sizeLevel } = {}) => {
  const profile = getPetProfile(petId)
  const normalizedSize = Number(sizeLevel)
  if (!profile || !Number.isInteger(normalizedSize) || normalizedSize < 0 || normalizedSize > 10) {
    return false
  }
  profile.sizeLevel = normalizedSize
  await writePetRegistry()
  const window = petWindows.get(petId)
  if (window && !window.isDestroyed()) {
    window.webContents.send('pet-size-changed', normalizedSize)
  }
  broadcastPetManagerState()
  return true
})

ipcMain.handle('pet-set-dance-mode', async (_event, { petIds, danceMode } = {}) => {
  const ids = normalizePetIds(petIds)
  if (!ids.length || !['off', 'solo', 'group'].includes(danceMode)) return false
  ids.forEach((id) => {
    getPetProfile(id).danceMode = danceMode
  })
  await writePetRegistry()
  broadcastPetManagerState()
  scheduleGroupDanceResync()
  return true
})

ipcMain.handle('pet-set-roaming-enabled', async (_event, { petIds, enabled } = {}) => {
  const ids = normalizePetIds(petIds)
  if (!ids.length || typeof enabled !== 'boolean') return false
  ids.forEach((id) => {
    getPetProfile(id).roamingEnabled = enabled
  })
  await writePetRegistry()
  broadcastPetManagerState()
  return true
})

ipcMain.handle('pet-set-enabled', async (_event, { petIds, enabled } = {}) => {
  const ids = normalizePetIds(petIds)
  if (!ids.length || typeof enabled !== 'boolean') return false
  for (const id of ids) {
    const profile = getPetProfile(id)
    profile.enabled = enabled
  }
  await writePetRegistry()
  if (enabled) {
    ids.forEach((id) => createPetWindow(getPetProfile(id)))
  } else {
    setTimeout(() => ids.forEach(closePetWindow), 0)
  }
  broadcastPetManagerState()
  return true
})

ipcMain.handle('pet-delete', async (event, petIds) => {
  const ids = normalizePetIds(petIds)
    .filter((id) => !getPetProfile(id)?.builtIn)
  if (!ids.length) return false
  const names = ids.map((id) => getPetProfile(id)?.name).filter(Boolean)
  const owner = BrowserWindow.fromWebContents(event.sender)
  const options = {
    type: 'warning',
    title: '删除桌宠',
    message: `确定删除 ${names.join('、')} 吗？`,
    detail: '对应窗口、模型、动作和设置都会删除。原始 VRM/VRMA 文件不会被删除。',
    buttons: ['取消', '删除'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
  const result = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options)
  if (result.response !== 1) return false

  petRegistry.pets = petRegistry.pets.filter(({ id }) => !ids.includes(id))
  const replacement = petRegistry.pets.length ? null : emptyPetProfile()
  if (replacement) petRegistry.pets.push(replacement)
  await Promise.all(ids.map((id) => rm(importedAssetsDirectory(id), { recursive: true, force: true })))
  await writePetRegistry()
  setTimeout(() => {
    ids.forEach(closePetWindow)
    if (replacement) createPetWindow(replacement)
  }, 0)
  broadcastPetManagerState()
  return true
})

ipcMain.handle('pet-toggle-group-dance', async (event) => {
  const profile = getPetProfile(petIdForEvent(event))
  if (!profile) return false
  profile.danceMode = profile.danceMode === 'group' ? 'solo' : 'group'
  await writePetRegistry()
  broadcastPetManagerState()
  scheduleGroupDanceResync()
  return profile.danceMode
})

ipcMain.on('pet-request-group-dance', (event, motion) => {
  const petId = petIdForEvent(event)
  if (petId !== currentGroupLeaderId()) return
  const name = typeof motion?.name === 'string' ? motion.name.slice(0, 160) : ''
  const key = typeof motion?.key === 'string' ? motion.key.slice(0, 160) : ''
  const ordinal = Number.isInteger(motion?.ordinal) ? motion.ordinal : 0
  const bpm = Number.isFinite(motion?.bpm)
    ? Math.max(60, Math.min(180, motion.bpm))
    : 116
  const commonDanceKeys = currentGroupCommonDanceKeys()
  if (!name || !key || !commonDanceKeys.includes(key)) return
  const payload = {
    name,
    key,
    ordinal,
    bpm,
    memberIds: currentGroupMemberIds(),
    startAt: Date.now() + 100,
  }
  for (const profile of petRegistry.pets) {
    if (!profile.enabled || profile.danceMode !== 'group') continue
    const window = petWindows.get(profile.id)
    if (window && !window.isDestroyed()) window.webContents.send('pet-group-dance', payload)
  }
})

function getSpotifyPlaybackState(callback) {
  if (process.platform !== 'darwin') {
    callback('unsupported', null)
    return
  }

  const args = SPOTIFY_STATE_SCRIPT.flatMap((line) => ['-e', line])
  execFile('/usr/bin/osascript', args, (error, stdout) => {
    if (error) {
      callback('unavailable', error.message)
      return
    }

    callback(stdout.trim().toLowerCase() || 'stopped', null)
  })
}

function pollSpotifyPlayback() {
  if (spotifyPollInFlight) return
  spotifyPollInFlight = true
  getSpotifyPlaybackState((state, errorMessage) => {
    spotifyPollInFlight = false
    if (state === lastSpotifyState) return
    lastSpotifyState = state
    if (errorMessage) console.error('Failed to read Spotify playback state:', errorMessage)
    console.log(`Spotify playback state: ${state}`)
    for (const window of petWindows.values()) {
      if (!window.isDestroyed()) window.webContents.send('spotify-playback-state', state)
    }
  })
}

function capturePetWindowBounds(petId) {
  const profile = getPetProfile(petId)
  const window = petWindows.get(petId)
  if (!profile || !window || window.isDestroyed()) return
  profile.bounds = sanitizeBounds(window.getBounds())
}

function closePetWindow(petId) {
  const window = petWindows.get(petId)
  if (!window || window.isDestroyed()) return
  capturePetWindowBounds(petId)
  writePetRegistry()
  window.close()
}

function createPetWindow(profile) {
  if (!profile?.enabled) return null
  const existing = petWindows.get(profile.id)
  if (existing && !existing.isDestroyed()) return existing
  const window = new BrowserWindow({
    width: 380,
    height: 600,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: PRELOAD_PATH,
    },
  })
  const webContentsId = window.webContents.id
  petWindows.set(profile.id, window)
  petIdByWebContents.set(webContentsId, profile.id)

  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  if (profile.bounds) {
    ensureWindowVisible(window, profile.bounds)
  } else {
    const primaryWorkArea = screen.getPrimaryDisplay().workArea
    const initialBounds = window.getBounds()
    const profileIndex = Math.max(0, petRegistry.pets.findIndex(({ id }) => id === profile.id))
    window.setPosition(
      Math.round(primaryWorkArea.x + primaryWorkArea.width - initialBounds.width - 24 - profileIndex * 42),
      Math.round(primaryWorkArea.y + primaryWorkArea.height - initialBounds.height - 24 - profileIndex * 28),
      false,
    )
  }
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Failed to load ${validatedURL}: ${errorCode} ${errorDescription}`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Renderer process exited: ${details.reason} (exit code ${details.exitCode})`)
  })
  window.webContents.on('console-message', (event) => {
    console.log(`[renderer] ${event.message}`)
  })
  window.webContents.on('did-finish-load', () => {
    ensureWindowVisible(window)
    if (lastSpotifyState === null) pollSpotifyPlayback()
    else window.webContents.send('spotify-playback-state', lastSpotifyState)
    window.webContents.send('pet-manager-state', petManagerState(profile.id))
  })
  window.on('close', () => capturePetWindowBounds(profile.id))
  window.on('closed', () => {
    stopWindowRoaming(window)
    stopWindowDrag(webContentsId)
    visibleBoundsByWebContents.delete(webContentsId)
    petIdByWebContents.delete(webContentsId)
    danceCatalogsByPetId.delete(profile.id)
    if (petWindows.get(profile.id) === window) petWindows.delete(profile.id)
    writePetRegistry()
    broadcastPetManagerState()
  })
  const rendererLoad = app.isPackaged
    ? window.loadFile(RENDERER_PATH, { query: { petId: profile.id } })
    : window.loadURL(`${VITE_DEV_SERVER_URL}?petId=${encodeURIComponent(profile.id)}`)
  rendererLoad.catch((error) => {
    console.error(`Failed to open ${app.isPackaged ? RENDERER_PATH : VITE_DEV_SERVER_URL}`, error)
  })
  broadcastPetManagerState()
  return window
}

app.whenReady().then(() => {
  protocol.handle('pet-assets', (request) => {
    const url = new URL(request.url)
    const petId = url.hostname
    if (!getPetProfile(petId)) return new Response('Unknown pet', { status: 404 })
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const target = parts[0] === 'animations' && parts[1]
      ? join(importedAssetsDirectory(petId), 'animations', basename(parts[1]))
      : join(importedAssetsDirectory(petId), 'model.vrm')
    return net.fetch(pathToFileURL(target).toString())
  })
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
    }).then((sources) => {
      if (sources.length === 0) {
        callback({})
        return
      }
      callback({ video: sources[0], audio: 'loopback' })
    }).catch((error) => {
      console.error('Failed to select a system audio source:', error)
      callback({})
    })
  })

  readPetRegistry().then((registry) => {
    petRegistry = registry
    return writePetRegistry()
  }).then(() => {
    petRegistry.pets.filter(({ enabled }) => enabled).forEach(createPetWindow)
  }).catch((error) => {
    console.error('Failed to initialize pet registry:', error)
    petRegistry = { version: 1, groupDanceEnabled: false, pets: [emptyPetProfile()] }
    createPetWindow(petRegistry.pets[0])
  })
  pollSpotifyPlayback()
  spotifyPollTimer = setInterval(pollSpotifyPlayback, 1000)

  app.on('activate', () => {
    const existing = [...petWindows.values()].find((window) => !window.isDestroyed())
    if (existing) {
      ensureWindowVisible(existing)
      existing.focus()
      return
    }
    const profile = petRegistry.pets[0] ?? emptyPetProfile()
    if (!petRegistry.pets.length) petRegistry.pets.push(profile)
    profile.enabled = true
    writePetRegistry()
    createPetWindow(profile)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (spotifyPollTimer !== null) clearInterval(spotifyPollTimer)
  for (const petId of petWindows.keys()) capturePetWindowBounds(petId)
  writePetRegistry()
})
