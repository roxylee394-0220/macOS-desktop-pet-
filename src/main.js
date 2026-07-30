import './style.css'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from '@pixiv/three-vrm-animation'

const currentPetId = new URLSearchParams(window.location.search).get('petId') ?? 'default'

function assetUrl(path) {
  if (!path) return path
  try {
    return new URL(path, window.location.href).href
  } catch {
    return path
  }
}

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100)
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })

renderer.setClearColor(0x000000, 0)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
renderer.outputColorSpace = THREE.SRGBColorSpace
document.querySelector('#app').appendChild(renderer.domElement)

scene.add(new THREE.AmbientLight(0xffffff, 1.5))

const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5)
directionalLight.position.set(1, 2, 3)
scene.add(directionalLight)

let vrm = null
const originalScenePosition = new THREE.Vector3()
const originalSceneQuaternion = new THREE.Quaternion()
let danceBones = {}
let danceBoneList = []
let isDancing = false
let manualDanceOverride = false
let danceBlend = 1
let danceBeat = 0
let vrmaMixer = null
let currentVrmaAction = null
let currentVrmaIndex = 0
let currentVrmaReferenceBpm = 116
let currentMotionRole = 'idle'
let lastAutoDanceSelectionAt = -Infinity
let nextAutoDanceSelectionAt = 0
let danceShuffleBag = []
const vrmaActions = []
const loadedMotionIndices = new Set()
let roamingEnabled = false
let usesBuiltInAssets = false
let modelReady = false
let petManagerState = null
let petDanceMode = 'solo'
let groupLeaderPetId = null
let groupCommonDanceKeys = []
let pendingGroupDanceTimer = null
let isRoaming = false
let roamDirection = 1
let nextRoamAt = 10
let roamStopAt = Infinity
let facingYaw = 0
let targetFacingYaw = 0
let landingPulse = 0
let landingElapsed = Infinity
let idlePose = 'neutral'
let nextIdlePoseAt = 18
let modelHeight = 1
let petSizeLevel = 5
let interactionPulse = 0
let interactionVariant = 0
let visibleModelBounds = null
let spotifyIsPlaying = false
let systemAudioStream = null
let systemAudioContext = null
let systemAudioSource = null
let systemAudioAnalyser = null
let systemAudioData = null
let systemAudioStarting = false
let systemAudioStartTimer = null
let musicDanceMuted = false
let audioMotionBoost = 1
let audioAnalysisElapsed = 0
let bassBaseline = 0
let beatPulse = 0
let lastDetectedBeatAt = -Infinity
let lastDetectedBpmLogAt = -Infinity
const detectedBeatBpms = []
const IDLE_POSES = ['neutral']

const DANCE_CONFIG = {
  bpm: 116,
  returnSeconds: 0.4,
  beatPhaseCorrection: 0.18,
  bounce: 0.012,
  hipsSway: 0.025,
  torsoCounterSway: 0.012,
  headNod: 0.012,
  headTurn: 0.025,
  headTilt: 0.008,
  shoulderLift: 0.025,
  upperArmSwing: 0.24,
  upperArmLiftBase: 0.13,
  upperArmLift: 0.14,
  lowerArmBendBase: 0.12,
  lowerArmBend: 0.04,
  upperLegSwing: 0.14,
  upperLegSway: 0.025,
  kneeBendBase: 0.12,
  kneeBend: 0.1,
  idleBounce: 0.01,
  idleBreath: 0.02,
  idleHeadPitch: 0.105,
  idleHeadNod: 0.012,
  idleHeadTurn: 0.018,
}
let currentBpm = DANCE_CONFIG.bpm
let targetBpm = DANCE_CONFIG.bpm
const MAX_FRAME_DELTA = 1 / 30
const DANCE_BONES = [
  'hips',
  'spine',
  'chest',
  'head',
  'leftShoulder',
  'rightShoulder',
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
  'leftUpperLeg',
  'rightUpperLeg',
  'leftLowerLeg',
  'rightLowerLeg',
]
const danceEuler = new THREE.Euler()
const danceRotation = new THREE.Quaternion()
const facingRotation = new THREE.Quaternion()
const facingAxis = new THREE.Vector3(0, 1, 0)
let VRMA_MOTIONS = []
let DANCE_INDICES = []
let IDLE_INDICES = []
let SIT_INDICES = []
let SLEEP_INDICES = []
let WALK_LEFT_INDEX = -1
let WALK_RIGHT_INDEX = -1
let DRAG_INDEX = -1
let LAND_INDEX = -1
let CLICK_INTERACTION_INDICES = []
const VRMA_CROSSFADE_SECONDS = 0.4

const IMPORTED_MOTION_PRESETS = {
  'slow-groove': { role: 'dance', profile: 'slow', referenceBpm: 90, active: [2.04, 13.67] },
  'pop-wave': { role: 'dance', profile: 'pop', referenceBpm: 116, active: [1.67, 15.83] },
  'fast-step': { role: 'dance', profile: 'fast', referenceBpm: 140, active: [2.79, 14.75] },
  'dance-01': { role: 'dance', profile: 'pop', referenceBpm: 116, active: [4.92, 39.63], keepHipsUpright: true },
  'dance-02': { role: 'dance', profile: 'pop', referenceBpm: 116, active: [1.92, 28.71] },
  'dance-03': { role: 'dance', profile: 'pop', referenceBpm: 116, active: [2.13, 37.33] },
  'dance-05': { role: 'dance', profile: 'slow', referenceBpm: 90, active: [1.88, 21.21] },
  'dance-06': { role: 'dance', profile: 'fast', referenceBpm: 140, active: [1.71, 19.63] },
  'dance-07': { role: 'dance', profile: 'fast', referenceBpm: 140, active: [1.13, 25.08] },
  memeshikute: { role: 'dance', profile: 'slow', referenceBpm: 90, active: [2.58, 20.25] },
  soranbushi: { role: 'dance', profile: 'fast', referenceBpm: 140, active: [2.04, 23.46] },
}

function configureImportedMotions(animations) {
  VRMA_MOTIONS = animations.map((animation) => {
    const { name, url } = animation
    const lower = name.toLowerCase()
    const normalizedName = lower.replace(/\.vrma$/i, '')
    const preset = IMPORTED_MOTION_PRESETS[normalizedName] ?? {}
    let role = animation.role ?? preset.role ?? 'dance'
    let clickInteraction = animation.clickInteraction === true
    if (lower.includes('sleep') || lower.includes('nap')) role = 'sleep'
    else if (lower.includes('sit')) role = 'sit'
    else if (lower.includes('idle')) role = 'idle'
    else if (lower.includes('walk')) role = 'walk'
    else if (lower.includes('drag') || lower.includes('stumble')) role = 'drag'
    else if (lower.includes('land')) role = 'release'
    else if (/^vrma_0[1-7](?:\.vrma)?$/.test(lower)) {
      role = 'interaction'
      clickInteraction = true
    }
    let profile = animation.profile ?? preset.profile ?? 'pop'
    if (lower.includes('slow') || lower.includes('groove')) profile = 'slow'
    else if (lower.includes('fast') || lower.includes('step')) profile = 'fast'
    else {
      const numberedDance = lower.match(/(?:dance-|vrma_)(\d+)/)
      if (numberedDance) profile = ['slow', 'pop', 'fast'][(Number(numberedDance[1]) - 1) % 3]
    }
    return {
      name: name.replace(/\.vrma$/i, ''),
      path: assetUrl(url),
      role,
      profile,
      referenceBpm: animation.referenceBpm
        ?? preset.referenceBpm
        ?? (profile === 'slow' ? 92 : profile === 'fast' ? 145 : DANCE_CONFIG.bpm),
      active: animation.active ?? preset.active,
      keepHipsUpright: animation.keepHipsUpright ?? preset.keepHipsUpright,
      neutralizeHead: animation.neutralizeHead ?? preset.neutralizeHead,
      removeHeadTracks: animation.removeHeadTracks ?? preset.removeHeadTracks,
      lockHorizontalRoot: animation.lockHorizontalRoot ?? preset.lockHorizontalRoot,
      lockRoot: animation.lockRoot ?? preset.lockRoot,
      clickInteraction,
    }
  })
  DANCE_INDICES = VRMA_MOTIONS.map((motion, index) => motion.role === 'dance' ? index : -1).filter((index) => index >= 0)
  danceShuffleBag = []
  IDLE_INDICES = VRMA_MOTIONS.map((motion, index) => motion.role === 'idle' ? index : -1).filter((index) => index >= 0)
  SIT_INDICES = VRMA_MOTIONS.map((motion, index) => motion.role === 'sit' ? index : -1).filter((index) => index >= 0)
  SLEEP_INDICES = VRMA_MOTIONS.map((motion, index) => motion.role === 'sleep' ? index : -1).filter((index) => index >= 0)
  const walkIndices = VRMA_MOTIONS.map((motion, index) => motion.role === 'walk' ? index : -1).filter((index) => index >= 0)
  WALK_LEFT_INDEX = walkIndices.find((index) => VRMA_MOTIONS[index].name.toLowerCase().includes('left')) ?? walkIndices[0] ?? -1
  WALK_RIGHT_INDEX = walkIndices.find((index) => VRMA_MOTIONS[index].name.toLowerCase().includes('right')) ?? walkIndices[0] ?? -1
  DRAG_INDEX = VRMA_MOTIONS.findIndex((motion) => motion.role === 'drag')
  LAND_INDEX = VRMA_MOTIONS.findIndex((motion) => motion.role === 'release')
  CLICK_INTERACTION_INDICES = VRMA_MOTIONS
    .map((motion, index) => (
      motion.role === 'interaction' || motion.clickInteraction ? index : -1
    ))
    .filter((index) => index >= 0)
  currentVrmaIndex = DANCE_INDICES[0] ?? IDLE_INDICES[0] ?? 0
}

function availableMotionIndices(indices) {
  return indices.filter((index) => loadedMotionIndices.has(index) && vrmaActions[index])
}

function selectVrmaMotion(index, fadeSeconds = VRMA_CROSSFADE_SECONDS, role = null) {
  const actionPair = vrmaActions[index]
  if (!actionPair) return
  const nextAction = actionPair.find((action) => action !== currentVrmaAction)
  if (!nextAction) return
  const effectiveRole = role ?? VRMA_MOTIONS[index].role ?? 'dance'
  const repeats = ['dance', 'idle', 'walk', 'drag', 'sit', 'sleep'].includes(effectiveRole)

  if (currentVrmaAction && currentVrmaAction !== nextAction) {
    currentVrmaAction.stopFading().setEffectiveWeight(1)
  }
  nextAction
    .stopFading()
    .reset()
    .setLoop(repeats ? THREE.LoopRepeat : THREE.LoopOnce, repeats ? Infinity : 1)
    .setEffectiveWeight(1)
    .play()
  if (currentVrmaAction && currentVrmaAction !== nextAction) {
    currentVrmaAction.crossFadeTo(nextAction, fadeSeconds, false)
  } else {
    nextAction.fadeIn(fadeSeconds)
  }
  nextAction.clampWhenFinished = !repeats
  currentVrmaAction = nextAction
  currentVrmaIndex = index
  currentMotionRole = effectiveRole
  currentVrmaReferenceBpm = VRMA_MOTIONS[index].referenceBpm ?? DANCE_CONFIG.bpm
  console.log(`VRMA ${index + 1}: ${VRMA_MOTIONS[index].name}`)
}

function selectIdleMotion(fadeSeconds = 0.65) {
  const wasIdle = currentMotionRole === 'idle'
  const availableIdle = availableMotionIndices(IDLE_INDICES)
  const candidates = availableIdle.filter((index) => index !== currentVrmaIndex)
  if (!candidates.length) {
    if (wasIdle && availableIdle.includes(currentVrmaIndex) && currentVrmaAction) return
    if (availableIdle.length) {
      selectVrmaMotion(availableIdle[0], fadeSeconds, 'idle')
      return
    }
    currentVrmaAction?.stopFading().fadeOut(fadeSeconds)
    currentVrmaAction = null
    currentMotionRole = 'idle'
    if (!wasIdle) nextRoamAt = animationElapsed + 8 + Math.random() * 10
    return
  }
  selectVrmaMotion(candidates[Math.floor(Math.random() * candidates.length)], fadeSeconds, 'idle')
  if (!wasIdle) nextRoamAt = animationElapsed + 8 + Math.random() * 10
}

function setIdlePose(pose, fadeSeconds = 0.7) {
  idlePose = IDLE_POSES.includes(pose) ? pose : 'neutral'
  stopRoaming(false)
  const choices = availableMotionIndices(IDLE_INDICES)
  if (choices.length) {
    const candidates = choices.filter((index) => index !== currentVrmaIndex)
    const pool = candidates.length ? candidates : choices
    selectVrmaMotion(pool[Math.floor(Math.random() * pool.length)], fadeSeconds, 'idle')
  } else {
    selectIdleMotion(fadeSeconds)
  }
  nextIdlePoseAt = animationElapsed + 18 + Math.random() * 12
  nextRoamAt = animationElapsed + 6 + Math.random() * 8
  console.log(`Idle pose: ${idlePose}`)
}

function useProceduralMotion(role, fadeSeconds = 0.15) {
  currentVrmaAction?.stopFading().fadeOut(fadeSeconds)
  currentVrmaAction = null
  currentMotionRole = role
}

function stopRoaming(playLanding = false) {
  if (isRoaming) window.desktopPet?.setRoaming(false)
  isRoaming = false
  targetFacingYaw = 0
  roamStopAt = Infinity
  if (playLanding && vrmaActions[LAND_INDEX]) selectVrmaMotion(LAND_INDEX, 0.2, 'release')
  else if (!spotifyIsPlaying && currentMotionRole === 'walk') selectIdleMotion()
}

function startRoaming() {
  if (
    !roamingEnabled
    || spotifyIsPlaying
    || isRoaming
    || idlePose !== 'neutral'
  ) return
  isRoaming = true
  // The main process reports when the selected point is actually reached.
  // This long timeout is only a safety net for a disconnected display.
  roamStopAt = animationElapsed + 120
  const walkIndex = roamDirection < 0 ? WALK_LEFT_INDEX : WALK_RIGHT_INDEX
  if (loadedMotionIndices.has(walkIndex)) selectVrmaMotion(walkIndex, 0.3, 'walk')
  else useProceduralMotion('walk')
  window.desktopPet?.setRoaming(true)
}

function playRandomClickInteraction() {
  stopRoaming(false)
  const choices = CLICK_INTERACTION_INDICES.filter((index) => index !== currentVrmaIndex && vrmaActions[index])
  if (!choices.length) {
    // Keep a lightweight fallback only for pets without any usable click VRMA.
    interactionVariant = 1
    interactionPulse = 1
    useProceduralMotion('interaction', 0.1)
    return
  }
  const selected = choices[Math.floor(Math.random() * choices.length)]
  selectVrmaMotion(selected, 0.2, 'interaction')
}

function takeNextShuffledDance(loadedDances) {
  danceShuffleBag = danceShuffleBag.filter((index) => loadedDances.includes(index))
  if (!danceShuffleBag.length) {
    danceShuffleBag = [...loadedDances]
    for (let index = danceShuffleBag.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1))
      ;[danceShuffleBag[index], danceShuffleBag[swapIndex]] = [
        danceShuffleBag[swapIndex],
        danceShuffleBag[index],
      ]
    }
    if (danceShuffleBag.length > 1 && danceShuffleBag[0] === currentVrmaIndex) {
      ;[danceShuffleBag[0], danceShuffleBag[1]] = [danceShuffleBag[1], danceShuffleBag[0]]
    }
  }
  return danceShuffleBag.shift()
}

function comparableMotionName(name) {
  return name.toLowerCase().replace(/\.vrma$/i, '').replace(/[^a-z0-9]+/g, '')
}

function selectAutomaticDance(elapsed) {
  if (
    !spotifyIsPlaying
    || petDanceMode === 'off'
    || (musicDanceMuted && petDanceMode !== 'group')
    || manualDanceOverride
    || elapsed < nextAutoDanceSelectionAt
  ) return
  let loadedDances = availableMotionIndices(DANCE_INDICES)
  if (petDanceMode === 'group') {
    const commonKeys = new Set(groupCommonDanceKeys)
    loadedDances = loadedDances.filter((index) => (
      commonKeys.has(comparableMotionName(VRMA_MOTIONS[index].name))
    ))
  }
  if (!loadedDances.length) return
  if (petDanceMode === 'group' && currentPetId !== groupLeaderPetId) return

  const index = takeNextShuffledDance(loadedDances)
  if (petDanceMode === 'group') {
    const phraseDuration = Math.min(
      Math.max(vrmaActions[index][0].getClip().duration * 0.85, 10),
      24,
    )
    nextAutoDanceSelectionAt = elapsed + phraseDuration + 1
    window.desktopPet?.requestGroupDance({
      name: VRMA_MOTIONS[index].name,
      key: comparableMotionName(VRMA_MOTIONS[index].name),
      ordinal: loadedDances.indexOf(index),
      bpm: targetBpm,
    })
    return
  }
  selectVrmaMotion(index, 0.7, 'dance')
  lastAutoDanceSelectionAt = elapsed
  const phraseDuration = Math.min(Math.max(vrmaActions[index][0].getClip().duration * 0.85, 10), 24)
  nextAutoDanceSelectionAt = elapsed + phraseDuration + Math.random() * 2
  console.log(`Automatic shuffled dance: ${VRMA_MOTIONS[index].name}`)
}

function scheduleGroupDance({
  name,
  key,
  memberIds = [],
  bpm = DANCE_CONFIG.bpm,
  startAt = Date.now(),
}) {
  if (!memberIds.includes(currentPetId) || musicDanceMuted) return
  petDanceMode = 'group'
  if (pendingGroupDanceTimer !== null) clearTimeout(pendingGroupDanceTimer)
  const delay = Math.max(0, startAt - Date.now())
  pendingGroupDanceTimer = window.setTimeout(() => {
    pendingGroupDanceTimer = null
    const loadedDances = availableMotionIndices(DANCE_INDICES)
    if (!loadedDances.length) return
    const normalizedName = key || comparableMotionName(name)
    const exactIndex = loadedDances.find((index) => (
      comparableMotionName(VRMA_MOTIONS[index].name) === normalizedName
    ))
    if (exactIndex == null) {
      console.warn(`Skipped synchronized dance because this pet does not have: ${name}`)
      setIdlePose('neutral', 0.4)
      return
    }
    const index = exactIndex
    targetBpm = THREE.MathUtils.clamp(bpm, 60, 180)
    currentBpm = targetBpm
    manualDanceOverride = false
    isDancing = true
    idlePose = 'neutral'
    stopRoaming(false)
    selectVrmaMotion(index, 0.45, 'dance')
    lastAutoDanceSelectionAt = animationElapsed
    const phraseDuration = Math.min(Math.max(vrmaActions[index][0].getClip().duration * 0.85, 10), 24)
    nextAutoDanceSelectionAt = animationElapsed + phraseDuration + 1
    console.log(`Synchronized group dance: ${VRMA_MOTIONS[index].name}`)
  }, delay)
}

function trimMotionClip(clip, activeRange) {
  if (!activeRange) return clip
  const [startTime, endTime] = activeRange
  const trimmedClip = clip.clone()
  trimmedClip.tracks.forEach((track) => {
    track.trim(startTime, endTime)
    track.shift(-startTime)
  })
  trimmedClip.resetDuration()
  return trimmedClip
}

function keepHipsUpright(clip, targetVrm) {
  const hips = targetVrm.humanoid?.getNormalizedBoneNode('hips')
  const track = clip.tracks.find((candidate) => candidate.name === `${hips?.name}.quaternion`)
  if (!track) return

  for (let offset = 0; offset < track.values.length; offset += 4) {
    const x = track.values[offset]
    const y = track.values[offset + 1]
    const z = track.values[offset + 2]
    const w = track.values[offset + 3]
    const yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z))
    track.values[offset] = 0
    track.values[offset + 1] = Math.sin(yaw / 2)
    track.values[offset + 2] = 0
    track.values[offset + 3] = Math.cos(yaw / 2)
  }
}

function neutralizeHeadStart(clip, targetVrm) {
  const headTrackNames = ['neck', 'head']
    .map((boneName) => targetVrm.humanoid?.getNormalizedBoneNode(boneName)?.name)
    .filter(Boolean)
    .map((nodeName) => `${nodeName}.quaternion`)

  const baseInverse = new THREE.Quaternion()
  const keyframe = new THREE.Quaternion()
  headTrackNames.forEach((trackName) => {
    const track = clip.tracks.find((candidate) => candidate.name === trackName)
    if (!track || track.values.length < 4) return
    baseInverse.fromArray(track.values, 0).invert()
    for (let offset = 0; offset < track.values.length; offset += 4) {
      keyframe.fromArray(track.values, offset).premultiply(baseInverse).normalize()
      keyframe.toArray(track.values, offset)
    }
  })
}

function removeHeadTracks(clip, targetVrm) {
  const nodeNames = ['neck', 'head']
    .map((boneName) => targetVrm.humanoid?.getNormalizedBoneNode(boneName)?.name)
    .filter(Boolean)
  clip.tracks = clip.tracks.filter((track) => (
    !nodeNames.some((nodeName) => track.name.startsWith(`${nodeName}.`))
  ))
  clip.resetDuration()
}

function removeHipsPositionTrack(clip, targetVrm) {
  const hips = targetVrm.humanoid?.getNormalizedBoneNode('hips')
  if (!hips) return
  clip.tracks = clip.tracks.filter((track) => track.name !== `${hips.name}.position`)
  clip.resetDuration()
}

async function loadVrmaMotions(targetVrm, onProgress = () => {}) {
  const animationLoader = new GLTFLoader()
  animationLoader.register((parser) => new VRMAnimationLoaderPlugin(parser))
  vrmaMixer = new THREE.AnimationMixer(targetVrm.scene)
  loadedMotionIndices.clear()
  vrmaActions.length = 0
  vrmaMixer.addEventListener('finished', (event) => {
    if (event.action !== currentVrmaAction) return
    if (currentMotionRole === 'interaction' || currentMotionRole === 'release') {
      selectIdleMotion()
    }
  })

  let nextIndex = 0
  let completedCount = 0
  const failures = []
  const loadNext = async () => {
    while (nextIndex < VRMA_MOTIONS.length) {
      const index = nextIndex
      nextIndex += 1
      const motion = VRMA_MOTIONS[index]
    try {
      const gltf = await animationLoader.loadAsync(motion.path)
      const vrmAnimation = gltf.userData.vrmAnimations?.[0]
      if (!vrmAnimation) throw new Error('No VRM animation track found')
      const fullClip = createVRMAnimationClip(vrmAnimation, targetVrm)
      const clip = trimMotionClip(fullClip, motion.active)
      if (!Number.isFinite(clip.duration) || clip.duration <= 0.05) {
        throw new Error('Animation clip is empty or too short')
      }
      // Only the humanoid hips translation controls whole-body displacement.
      // Preserve any legitimate non-hips position tracks in custom animations.
      removeHipsPositionTrack(clip, targetVrm)
      if (motion.keepHipsUpright) keepHipsUpright(clip, targetVrm)
      if (motion.neutralizeHead) neutralizeHeadStart(clip, targetVrm)
      if (motion.removeHeadTracks) removeHeadTracks(clip, targetVrm)
      clip.name = motion.name
      const alternateClip = clip.clone()
      alternateClip.name = `${motion.name} loop`
      vrmaActions[index] = [
        vrmaMixer.clipAction(clip),
        vrmaMixer.clipAction(alternateClip),
      ]
      loadedMotionIndices.add(index)
      console.log(`Loaded VRMA ${index + 1}: ${motion.name} (${clip.duration.toFixed(2)}s)`)
    } catch (error) {
      failures.push({ name: motion.name, message: error?.message ?? String(error) })
      console.error(`Failed to load VRMA ${index + 1}: ${motion.name}`, error)
    } finally {
      completedCount += 1
      onProgress({
        completed: completedCount,
        total: VRMA_MOTIONS.length,
        loaded: loadedMotionIndices.size,
        failed: failures.length,
      })
    }
    }
  }
  const workerCount = Math.min(3, Math.max(VRMA_MOTIONS.length, 1))
  await Promise.all(Array.from({ length: workerCount }, () => loadNext()))

  const loadedDances = availableMotionIndices(DANCE_INDICES)
  window.desktopPet?.setDanceCatalog(
    loadedDances.map((index) => comparableMotionName(VRMA_MOTIONS[index].name)),
  )
  currentVrmaIndex = loadedDances[0] ?? availableMotionIndices(IDLE_INDICES)[0] ?? 0
  if (spotifyIsPlaying && petDanceMode !== 'off' && !musicDanceMuted) {
    nextAutoDanceSelectionAt = 0
    selectAutomaticDance(animationElapsed)
  } else if (manualDanceOverride && loadedDances.length) {
    selectVrmaMotion(loadedDances[0], 0.2, 'dance')
  } else {
    selectIdleMotion()
  }
  return { loadedCount: loadedMotionIndices.size, failures }
}

window.desktopPet?.onSpotifyPlaybackChanged((state) => {
  spotifyIsPlaying = state === 'playing'
  if (spotifyIsPlaying && petDanceMode !== 'off' && !musicDanceMuted) {
    manualDanceOverride = false
    isDancing = true
    idlePose = 'neutral'
    stopRoaming(false)
    danceShuffleBag = []
    nextAutoDanceSelectionAt = 0
    selectAutomaticDance(animationElapsed)
    if (!systemAudioAnalyser && !systemAudioStarting && systemAudioStartTimer === null) {
      // Let the idle-to-dance crossfade settle before macOS starts the more
      // expensive screen-audio capture session.
      systemAudioStartTimer = window.setTimeout(() => {
        systemAudioStartTimer = null
        if (
          spotifyIsPlaying
          && !musicDanceMuted
          && (petDanceMode === 'solo' || currentPetId === groupLeaderPetId)
        ) startSystemAudioAnalysis(true)
      }, 1200)
    }
  } else if (!manualDanceOverride) {
    if (systemAudioStartTimer !== null) {
      clearTimeout(systemAudioStartTimer)
      systemAudioStartTimer = null
    }
    isDancing = false
    setIdlePose('neutral')
  }
  if (!spotifyIsPlaying) {
    bassBaseline = 0
    beatPulse = 0
    lastDetectedBeatAt = -Infinity
    detectedBeatBpms.length = 0
  }
  systemAudioStream?.getAudioTracks().forEach((track) => {
    track.enabled = spotifyIsPlaying
  })
  if (systemAudioContext) {
    const contextAction = spotifyIsPlaying
      ? systemAudioContext.resume()
      : systemAudioContext.suspend()
    contextAction.catch((error) => console.error('Could not update audio analysis state:', error))
  }
  console.log(`Spotify ${state}; dance ${isDancing ? 'enabled' : 'idle'}`)
})

async function startSystemAudioAnalysis(automatic = false) {
  if (systemAudioAnalyser) {
    systemAudioStream?.getAudioTracks().forEach((track) => { track.enabled = true })
    await systemAudioContext?.resume()
    console.log('System audio analysis resumed.')
    return
  }
  if (systemAudioStarting) return
  systemAudioStarting = true

  try {
    systemAudioStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    const audioTracks = systemAudioStream.getAudioTracks()
    if (audioTracks.length === 0) {
      systemAudioStream.getTracks().forEach((track) => track.stop())
      systemAudioStream = null
      console.warn('System audio capture started without an audio track.')
      return
    }

    systemAudioStream.getVideoTracks().forEach((track) => track.stop())
    systemAudioContext = new AudioContext()
    await systemAudioContext.resume()
    systemAudioSource = systemAudioContext.createMediaStreamSource(new MediaStream(audioTracks))
    systemAudioAnalyser = systemAudioContext.createAnalyser()
    systemAudioAnalyser.fftSize = 1024
    systemAudioAnalyser.smoothingTimeConstant = 0.8
    systemAudioData = new Uint8Array(systemAudioAnalyser.frequencyBinCount)
    systemAudioSource.connect(systemAudioAnalyser)
    audioTracks[0].enabled = true
    audioTracks[0].addEventListener('ended', () => {
      console.warn('System audio track ended; press M to enable it again.')
      systemAudioAnalyser = null
      systemAudioData = null
      audioMotionBoost = 1
    })
    localStorage.setItem('systemAudioAnalysisEnabled', 'true')
    console.log('System audio analysis enabled.')
  } catch (error) {
    const hint = automatic ? ' Click the pet and press M to enable it manually.' : ''
    console.error(`System audio analysis could not start.${hint}`, error)
  } finally {
    systemAudioStarting = false
  }
}

function applyDanceRotation(name, x, y, z, audioResponsive = true) {
  const controlled = danceBones[name]
  if (!controlled) return
  const beatMotionBoost = 1 + beatPulse * 0.35
  const weight = danceBlend * (audioResponsive ? audioMotionBoost * beatMotionBoost : 1)
  danceEuler.set(x * weight, y * weight, z * weight)
  danceRotation.setFromEuler(danceEuler)
  controlled.bone.quaternion.copy(controlled.baseQuaternion).multiply(danceRotation)
}

function applyAdditionalRotation(name, x, y, z, weight) {
  const controlled = danceBones[name]
  if (!controlled) return
  danceEuler.set(x * weight, y * weight, z * weight)
  danceRotation.setFromEuler(danceEuler)
  controlled.bone.quaternion.multiply(danceRotation)
}

function frameModel(model) {
  const bounds = new THREE.Box3().setFromObject(model)
  const size = bounds.getSize(new THREE.Vector3())
  modelHeight = Math.max(size.y, 0.1)
  const center = bounds.getCenter(new THREE.Vector3())
  // Match the previous local app: aim below the avatar's geometric center so
  // the visible character sits near the top of the transparent BrowserWindow.
  // macOS keeps the window itself below the menu bar, so this camera offset is
  // what lets the character visually reach the top edge.
  center.y -= size.y * 0.6
  const verticalFov = THREE.MathUtils.degToRad(camera.fov)
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect)
  const sizeScale = 0.55 + petSizeLevel * 0.09
  const distance = Math.max(
    size.y / (2 * Math.tan(verticalFov / 2)),
    size.x / (2 * Math.tan(horizontalFov / 2)),
  ) * (2.4 / sizeScale)

  camera.position.set(center.x, center.y, center.z + distance)
  camera.near = Math.max(distance / 100, 0.01)
  camera.far = distance * 10
  camera.lookAt(center)
  camera.updateProjectionMatrix()
}

function reportVisibleModelBounds(model) {
  model.updateMatrixWorld(true)
  camera.updateMatrixWorld(true)

  const bounds = new THREE.Box3().setFromObject(model)
  const { min, max } = bounds
  const corners = [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ]
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity

  for (const corner of corners) {
    corner.project(camera)
    const x = (corner.x * 0.5 + 0.5) * window.innerWidth
    const y = (-corner.y * 0.5 + 0.5) * window.innerHeight
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }

  const motionMargin = 20
  visibleModelBounds = {
    left: Math.max(0, Math.floor(left - 4)),
    top: Math.max(0, Math.floor(top - 4)),
    right: Math.min(window.innerWidth, Math.ceil(right + 4)),
    bottom: Math.min(window.innerHeight, Math.ceil(bottom + 4)),
  }
  window.desktopPet?.setVisibleBounds({
    left: Math.max(0, Math.floor(left - motionMargin)),
    top: Math.max(0, Math.floor(top - motionMargin)),
    right: Math.min(window.innerWidth, Math.ceil(right + motionMargin)),
    bottom: Math.min(window.innerHeight, Math.ceil(bottom + motionMargin)),
  })
}

const loader = new GLTFLoader()
loader.register((parser) => new VRMLoaderPlugin(parser))

const builtInMotion = (name, relativePath, options = {}) => ({
  name,
  url: `./animations/${relativePath}`,
  ...options,
})

// Preserve the proven action order and roles from the previous local app.
const BUILT_IN_ANIMATIONS = [
  builtInMotion('Show full body', 'official-vroid/VRMA_01.vrma', { role: 'interaction', clickInteraction: true }),
  builtInMotion('Greeting', 'official-vroid/VRMA_02.vrma', { role: 'interaction', clickInteraction: true }),
  builtInMotion('Peace sign', 'official-vroid/VRMA_03.vrma', { role: 'interaction', clickInteraction: true }),
  builtInMotion('Shoot', 'official-vroid/VRMA_04.vrma', { role: 'interaction', clickInteraction: true }),
  builtInMotion('Spin', 'official-vroid/VRMA_05.vrma', { role: 'interaction', clickInteraction: true }),
  builtInMotion('Model pose', 'official-vroid/VRMA_06.vrma', { role: 'interaction', clickInteraction: true }),
  builtInMotion('Squat', 'official-vroid/VRMA_07.vrma', { role: 'interaction', clickInteraction: true }),
  builtInMotion('Slow groove', 'dance-pack/slow-groove.vrma', {
    role: 'dance', profile: 'slow', referenceBpm: 90, active: [2.04, 13.67],
  }),
  builtInMotion('Pop wave', 'dance-pack/pop-wave.vrma', {
    role: 'dance', profile: 'pop', referenceBpm: 116, active: [1.67, 15.83],
  }),
  builtInMotion('Fast step', 'dance-pack/fast-step.vrma', {
    role: 'dance', profile: 'fast', referenceBpm: 140, active: [2.79, 14.75],
  }),
  builtInMotion('Dance 01', 'dance-pack/dance-01.vrma', {
    role: 'dance', profile: 'pop', referenceBpm: 116, active: [4.92, 39.63], keepHipsUpright: true,
  }),
  builtInMotion('Dance 02', 'dance-pack/dance-02.vrma', {
    role: 'dance', profile: 'pop', referenceBpm: 116, active: [1.92, 28.71],
  }),
  builtInMotion('Dance 03', 'dance-pack/dance-03.vrma', {
    role: 'dance', profile: 'pop', referenceBpm: 116, active: [2.13, 37.33],
  }),
  builtInMotion('Dance 05', 'dance-pack/dance-05.vrma', {
    role: 'dance', profile: 'slow', referenceBpm: 90, active: [1.88, 21.21],
  }),
  builtInMotion('Dance 06', 'dance-pack/dance-06.vrma', {
    role: 'dance', profile: 'fast', referenceBpm: 140, active: [1.71, 19.63],
  }),
  builtInMotion('Dance 07', 'dance-pack/dance-07.vrma', {
    role: 'dance', profile: 'fast', referenceBpm: 140, active: [1.13, 25.08],
  }),
  builtInMotion('Memeshikute', 'dance-pack/memeshikute.vrma', {
    role: 'dance', profile: 'slow', referenceBpm: 90, active: [2.58, 20.25],
  }),
  builtInMotion('Soran Bushi', 'dance-pack/soranbushi.vrma', {
    role: 'dance', profile: 'fast', referenceBpm: 140, active: [2.04, 23.46],
  }),
  builtInMotion('Idle neutral', 'locomotion/idle-neutral.vrma', {
    role: 'idle', lockHorizontalRoot: true, removeHeadTracks: true,
  }),
  builtInMotion('Idle look around', 'locomotion/idle-look-around.vrma', {
    role: 'idle', lockHorizontalRoot: true, removeHeadTracks: true,
  }),
  builtInMotion('Idle weight shift', 'locomotion/idle-weight-shift.vrma', {
    role: 'idle', lockHorizontalRoot: true, removeHeadTracks: true,
  }),
  builtInMotion('Walk left', 'locomotion/walk-forward.vrma', {
    role: 'walk', lockHorizontalRoot: true, active: [0.42, 5.54],
  }),
  builtInMotion('Walk right', 'locomotion/walk-forward.vrma', {
    role: 'walk', lockHorizontalRoot: true, active: [0.42, 5.54],
  }),
  builtInMotion('Drag reaction', 'locomotion/stumble-recover.vrma', {
    role: 'drag', lockRoot: true, active: [0.25, 3.75],
  }),
  builtInMotion('Land softly', 'locomotion/land-soft.vrma', {
    role: 'release', lockRoot: true, active: [0.25, 3],
  }),
]

const assetPanel = document.createElement('div')
assetPanel.className = 'asset-panel pending'
assetPanel.innerHTML = `
  <section class="pet-manager">
    <div class="pet-manager-title">
      <span>桌宠管理</span>
      <span data-role="group-mode">本窗口：独舞</span>
    </div>
    <div class="pet-list" data-role="pet-list"></div>
    <div class="pet-manager-actions">
      <button type="button" data-action="create-pet">新增桌宠</button>
      <button type="button" data-action="start-pets">启动所选</button>
      <button type="button" data-action="stop-pets">关闭所选</button>
      <button type="button" data-action="dance-off">所选不跳舞</button>
      <button type="button" data-action="dance-solo">所选独舞</button>
      <button type="button" data-action="dance-group">所选齐舞</button>
      <button type="button" data-action="roaming-on">所选开启走路</button>
      <button type="button" data-action="roaming-off">所选关闭走路</button>
      <button type="button" data-action="delete-pets">删除所选桌宠</button>
    </div>
  </section>
  <div class="asset-message">请先导入你有权使用的 VRM 模型；加载后按 V 可重新打开导入面板</div>
  <button type="button" data-action="model" data-asset-operation>导入 VRM</button>
  <button type="button" data-action="animations" data-asset-operation>导入 VRMA</button>
  <select data-action="asset" data-asset-management aria-label="选择要删除的文件"></select>
  <button type="button" data-action="delete-one" data-asset-management>删除选中文件</button>
  <button type="button" data-action="reset" data-asset-management>初始化（删除全部）</button>
`
document.querySelector('#app').appendChild(assetPanel)

function selectedPetIds() {
  return [...assetPanel.querySelectorAll('[data-pet-select]:checked')]
    .map((input) => input.dataset.petSelect)
}

const danceModeLabel = (mode) => ({
  off: '不跳舞',
  solo: '独舞',
  group: '齐舞',
}[mode] ?? '独舞')

function updateCurrentDanceMode(mode, leaderPetId) {
  const normalizedMode = ['off', 'solo', 'group'].includes(mode) ? mode : 'solo'
  const previousMode = petDanceMode
  const wasLeader = groupLeaderPetId === currentPetId
  petDanceMode = normalizedMode
  groupLeaderPetId = leaderPetId

  if (petDanceMode !== 'group' && pendingGroupDanceTimer !== null) {
    clearTimeout(pendingGroupDanceTimer)
    pendingGroupDanceTimer = null
  }
  if (previousMode === petDanceMode && wasLeader === (groupLeaderPetId === currentPetId)) return

  if (petDanceMode === 'off') {
    manualDanceOverride = false
    isDancing = false
    setIdlePose('neutral', 0.3)
    return
  }
  if (!spotifyIsPlaying || musicDanceMuted) return

  manualDanceOverride = false
  isDancing = true
  idlePose = 'neutral'
  stopRoaming(false)
  danceShuffleBag = []
  nextAutoDanceSelectionAt = 0
  if (petDanceMode === 'solo' || groupLeaderPetId === currentPetId) {
    selectAutomaticDance(animationElapsed)
  }
}

function renderPetManager(state) {
  if (!state) return
  petManagerState = state
  const currentProfile = state.pets.find(({ id }) => id === currentPetId)
  groupCommonDanceKeys = Array.isArray(state.groupCommonDanceKeys)
    ? state.groupCommonDanceKeys
    : []
  const previousRoamingEnabled = roamingEnabled
  roamingEnabled = currentProfile?.roamingEnabled !== false
  if (previousRoamingEnabled && !roamingEnabled) stopRoaming(false)
  if (!previousRoamingEnabled && roamingEnabled) nextRoamAt = animationElapsed + 1
  updateCurrentDanceMode(currentProfile?.danceMode, state.groupLeaderId)
  assetPanel.querySelector('[data-role="group-mode"]').textContent =
    petDanceMode === 'group'
      ? (
          groupCommonDanceKeys.length
            ? `本窗口：齐舞 · 共同动作 ${groupCommonDanceKeys.length}`
            : '本窗口：齐舞 · 无共同动作'
        )
      : `本窗口：${danceModeLabel(petDanceMode)}（G：独舞/齐舞）`
  const list = assetPanel.querySelector('[data-role="pet-list"]')
  list.replaceChildren(...state.pets.map((pet) => {
    const row = document.createElement('div')
    row.className = 'pet-row'
    if (pet.id === state.currentPetId) row.classList.add('current')

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.dataset.petSelect = pet.id
    checkbox.setAttribute('aria-label', `选择 ${pet.name}`)

    const name = document.createElement('input')
    name.type = 'text'
    name.value = pet.name
    name.maxLength = 40
    name.dataset.petName = pet.id
    name.setAttribute('aria-label', `命名 ${pet.name}`)

    const size = document.createElement('select')
    size.dataset.petSize = pet.id
    size.setAttribute('aria-label', `调整 ${pet.name} 的大小`)
    for (let level = 0; level <= 10; level += 1) {
      const option = document.createElement('option')
      option.value = String(level)
      option.textContent = `大小 ${level}`
      option.selected = level === pet.sizeLevel
      size.appendChild(option)
    }

    const danceMode = document.createElement('select')
    danceMode.dataset.petDanceMode = pet.id
    danceMode.setAttribute('aria-label', `设置 ${pet.name} 的舞蹈模式`)
    ;[
      ['off', '不跳舞'],
      ['solo', '独舞'],
      ['group', '齐舞'],
    ].forEach(([value, label]) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      option.selected = value === pet.danceMode
      danceMode.appendChild(option)
    })

    const roaming = document.createElement('select')
    roaming.dataset.petRoaming = pet.id
    roaming.setAttribute('aria-label', `设置 ${pet.name} 的自动走路`)
    ;[
      ['true', '走路开'],
      ['false', '走路关'],
    ].forEach(([value, label]) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      option.selected = (value === 'true') === pet.roamingEnabled
      roaming.appendChild(option)
    })

    const status = document.createElement('span')
    status.className = pet.running ? 'pet-status running' : 'pet-status'
    status.textContent = pet.running ? '运行中' : '已关闭'
    if (pet.builtIn) status.title = '默认桌宠不能删除'

    const settings = document.createElement('div')
    settings.className = 'pet-row-settings'
    settings.append(size, danceMode, roaming)
    row.append(checkbox, name, status, settings)
    return row
  }))
  const createButton = assetPanel.querySelector('[data-action="create-pet"]')
  createButton.disabled = state.pets.length >= state.maxPets
  createButton.textContent = state.pets.length >= state.maxPets
    ? `已达到 ${state.maxPets} 个上限`
    : `新增桌宠（${state.pets.length}/${state.maxPets}）`
}

assetPanel.querySelector('[data-role="pet-list"]').addEventListener('change', async (event) => {
  const roaming = event.target.closest('[data-pet-roaming]')
  if (roaming) {
    const updated = await window.desktopPet?.setPetsRoamingEnabled(
      [roaming.dataset.petRoaming],
      roaming.value === 'true',
    )
    if (!updated && petManagerState) renderPetManager(petManagerState)
    return
  }
  const danceMode = event.target.closest('[data-pet-dance-mode]')
  if (danceMode) {
    const updated = await window.desktopPet?.setPetsDanceMode(
      [danceMode.dataset.petDanceMode],
      danceMode.value,
    )
    if (!updated && petManagerState) renderPetManager(petManagerState)
    return
  }
  const size = event.target.closest('[data-pet-size]')
  if (size) {
    const updated = await window.desktopPet?.setPetSize(
      size.dataset.petSize,
      Number(size.value),
    )
    if (!updated && petManagerState) renderPetManager(petManagerState)
    return
  }
  const input = event.target.closest('[data-pet-name]')
  if (!input) return
  const renamed = await window.desktopPet?.renamePet(input.dataset.petName, input.value)
  if (!renamed && petManagerState) renderPetManager(petManagerState)
})

assetPanel.querySelector('[data-action="create-pet"]').addEventListener('click', async () => {
  try {
    renderPetManager(await window.desktopPet?.createPet())
  } catch (error) {
    assetPanel.querySelector('.asset-message').textContent =
      `新增桌宠失败：${error?.message ?? '未知错误'}`
  }
})

assetPanel.querySelector('[data-action="start-pets"]').addEventListener('click', async () => {
  const petIds = selectedPetIds()
  if (petIds.length) await window.desktopPet?.setPetsEnabled(petIds, true)
})

assetPanel.querySelector('[data-action="stop-pets"]').addEventListener('click', async () => {
  const petIds = selectedPetIds()
  if (petIds.length) await window.desktopPet?.setPetsEnabled(petIds, false)
})

for (const [action, danceMode] of [
  ['dance-off', 'off'],
  ['dance-solo', 'solo'],
  ['dance-group', 'group'],
]) {
  assetPanel.querySelector(`[data-action="${action}"]`).addEventListener('click', async () => {
    const petIds = selectedPetIds()
    if (petIds.length) await window.desktopPet?.setPetsDanceMode(petIds, danceMode)
  })
}

for (const [action, enabled] of [
  ['roaming-on', true],
  ['roaming-off', false],
]) {
  assetPanel.querySelector(`[data-action="${action}"]`).addEventListener('click', async () => {
    const petIds = selectedPetIds()
    if (petIds.length) await window.desktopPet?.setPetsRoamingEnabled(petIds, enabled)
  })
}

assetPanel.querySelector('[data-action="delete-pets"]').addEventListener('click', async () => {
  const selected = selectedPetIds()
  const petIds = selected.filter((petId) => (
    !petManagerState?.pets.find(({ id }) => id === petId)?.builtIn
  ))
  if (petIds.length) await window.desktopPet?.deletePets(petIds)
  else if (selected.length) {
    assetPanel.querySelector('.asset-message').textContent = '默认桌宠不能删除，但可以关闭'
  }
})

assetPanel.querySelector('[data-action="model"]').addEventListener('click', async () => {
  const button = assetPanel.querySelector('[data-action="model"]')
  button.disabled = true
  assetPanel.querySelector('.asset-message').textContent = '正在导入 VRM 模型…'
  try {
    const result = await window.desktopPet?.importModel()
    if (result?.modelUrl) window.location.reload()
    else assetPanel.querySelector('.asset-message').textContent = '未选择模型'
  } catch (error) {
    assetPanel.querySelector('.asset-message').textContent = `模型导入失败：${error?.message ?? '未知错误'}`
  } finally {
    button.disabled = false
  }
})
assetPanel.querySelector('[data-action="animations"]').addEventListener('click', async () => {
  const button = assetPanel.querySelector('[data-action="animations"]')
  button.disabled = true
  assetPanel.querySelector('.asset-message').textContent = '正在导入 VRMA 动作…'
  try {
    const result = await window.desktopPet?.importAnimations()
    if (result) window.location.reload()
    else assetPanel.querySelector('.asset-message').textContent = '未选择动作'
  } catch (error) {
    assetPanel.querySelector('.asset-message').textContent = `动作导入失败：${error?.message ?? '未知错误'}`
  } finally {
    button.disabled = false
  }
})
assetPanel.querySelector('[data-action="delete-one"]').addEventListener('click', async () => {
  const buttons = [...assetPanel.querySelectorAll('button')]
  const select = assetPanel.querySelector('[data-action="asset"]')
  const [type, encodedName = ''] = select.value.split(':', 2)
  buttons.forEach((button) => { button.disabled = true })
  assetPanel.querySelector('.asset-message').textContent = '正在等待删除确认…'
  try {
    const deleted = await window.desktopPet?.deleteImportedAsset({
      type,
      name: decodeURIComponent(encodedName),
    })
    if (deleted) window.location.reload()
    else assetPanel.querySelector('.asset-message').textContent = '已取消删除'
  } catch (error) {
    assetPanel.querySelector('.asset-message').textContent = `删除失败：${error?.message ?? '未知错误'}`
  } finally {
    buttons.forEach((button) => { button.disabled = false })
  }
})
assetPanel.querySelector('[data-action="reset"]').addEventListener('click', async () => {
  const buttons = [...assetPanel.querySelectorAll('button')]
  buttons.forEach((button) => { button.disabled = true })
  assetPanel.querySelector('.asset-message').textContent = '正在等待初始化确认…'
  try {
    const reset = await window.desktopPet?.resetImportedAssets()
    if (reset) window.location.reload()
    else assetPanel.querySelector('.asset-message').textContent = '已取消初始化'
  } catch (error) {
    assetPanel.querySelector('.asset-message').textContent = `初始化失败：${error?.message ?? '未知错误'}`
  } finally {
    buttons.forEach((button) => { button.disabled = false })
  }
})

function loadUserModel(modelUrl) {
  assetPanel.querySelector('.asset-message').textContent = '正在加载 VRM 模型…'
  loader.load(
    assetUrl(modelUrl),
    async (gltf) => {
    vrm = gltf.userData.vrm
    VRMUtils.removeUnnecessaryVertices(gltf.scene)
    VRMUtils.combineSkeletons(gltf.scene)
    VRMUtils.rotateVRM0(vrm)
    vrm.scene.traverse((object) => {
      if (object.isMesh || object.isSkinnedMesh) object.frustumCulled = false
    })
    originalScenePosition.copy(vrm.scene.position)
    originalSceneQuaternion.copy(vrm.scene.quaternion)

    scene.add(vrm.scene)
    vrm.scene.updateMatrixWorld(true)
    frameModel(vrm.scene)
    reportVisibleModelBounds(vrm.scene)

    danceBones = {}
    DANCE_BONES.forEach((name) => {
      const bone = vrm.humanoid?.getNormalizedBoneNode(name)
      if (bone) danceBones[name] = { bone, baseQuaternion: bone.quaternion.clone() }
    })
    danceBoneList = Object.values(danceBones)
    const loadResult = await loadVrmaMotions(vrm, ({ completed, total, loaded, failed }) => {
      assetPanel.querySelector('.asset-message').textContent =
        `正在加载动作 ${completed}/${total}（成功 ${loaded}，失败 ${failed}）`
    })
    nextRoamAt = animationElapsed + 10 + Math.random() * 6
    modelReady = true
    assetPanel.classList.add('compact')
    assetPanel.classList.toggle('has-status', loadResult.failures.length > 0)
    assetPanel.classList.toggle('hidden', loadResult.failures.length === 0)
    assetPanel.querySelector('.asset-message').textContent = loadResult.failures.length
      ? `${loadResult.loadedCount} 个动作可用；失败：${loadResult.failures.map(({ name }) => name).join('、')}`
      : `${loadResult.loadedCount} 个动作可用`
    },
    undefined,
    (error) => {
      assetPanel.querySelector('.asset-message').textContent = '模型加载失败，请重新导入 VRM'
      console.error('Failed to load imported VRM model', error)
    },
  )
}

function startWithAssets(assets, forceBuiltIn = false) {
  const useBuiltInAssets = forceBuiltIn || assets.builtIn
  const importedAssets = [
    ...(assets.modelUrl ? [{
      value: 'model:',
      label: `VRM：${assets.modelName ?? '当前模型'}`,
    }] : []),
    ...(assets.animations ?? []).map(({ name }) => ({
      value: `animation:${encodeURIComponent(name)}`,
      label: `VRMA：${name}`,
    })),
  ]
  usesBuiltInAssets = useBuiltInAssets
  assetPanel.classList.remove('pending')
  if (useBuiltInAssets) assetPanel.classList.add('built-in')
  assetPanel.classList.toggle(
    'has-imported-assets',
    !useBuiltInAssets && importedAssets.length > 0,
  )
  const assetSelect = assetPanel.querySelector('[data-action="asset"]')
  assetSelect.replaceChildren(...importedAssets.map(({ value, label }) => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    return option
  }))
  configureImportedMotions(useBuiltInAssets ? BUILT_IN_ANIMATIONS : (assets.animations ?? []))
  const modelUrl = useBuiltInAssets ? './model.vrm' : assets.modelUrl
  if (modelUrl) loadUserModel(modelUrl)
}

window.desktopPet?.onPetManagerStateChanged?.(renderPetManager)
window.desktopPet?.onPetSizeChanged?.((sizeLevel) => {
  if (!Number.isInteger(sizeLevel) || sizeLevel < 0 || sizeLevel > 10) return
  petSizeLevel = sizeLevel
  if (vrm) {
    frameModel(vrm.scene)
    reportVisibleModelBounds(vrm.scene)
  }
})
window.desktopPet?.onGroupDance?.(scheduleGroupDance)
window.desktopPet?.onGroupDanceResync?.(() => {
  if (
    petDanceMode !== 'group'
    || currentPetId !== groupLeaderPetId
    || !spotifyIsPlaying
  ) return
  nextAutoDanceSelectionAt = 0
  selectAutomaticDance(animationElapsed)
})
window.desktopPet?.getPetManagerState?.()
  .then((state) => {
    const currentProfile = state?.pets?.find(({ id }) => id === currentPetId)
    if (Number.isInteger(currentProfile?.sizeLevel)) petSizeLevel = currentProfile.sizeLevel
    renderPetManager(state)
    if (vrm) {
      frameModel(vrm.scene)
      reportVisibleModelBounds(vrm.scene)
    }
  })
  .catch((error) => console.error('Failed to load pet manager state', error))

const startupAssets = window.desktopPet?.getImportedAssets()
  ?? Promise.resolve({ builtIn: true, modelUrl: null, animations: [] })
startupAssets
  .then((assets) => startWithAssets(assets))
  .catch((error) => {
    assetPanel.classList.remove('pending')
    console.error('Failed to resolve startup assets', error)
  })

function resize() {
  const width = window.innerWidth
  const height = window.innerHeight
  renderer.setSize(width, height)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  if (vrm) {
    frameModel(vrm.scene)
    reportVisibleModelBounds(vrm.scene)
  }
}

window.addEventListener('resize', resize)
window.desktopPet?.onRoamDirectionChanged((direction) => {
  roamDirection = direction
  targetFacingYaw = direction < 0 ? -Math.PI / 2 : Math.PI / 2
  if (isRoaming) {
    const walkIndex = direction < 0 ? WALK_LEFT_INDEX : WALK_RIGHT_INDEX
    if (loadedMotionIndices.has(walkIndex)) selectVrmaMotion(walkIndex, 0.25, 'walk')
    else useProceduralMotion('walk')
  }
})
window.desktopPet?.onRoamTargetReached?.(() => {
  if (!isRoaming) return
  stopRoaming(false)
  nextRoamAt = animationElapsed + 7 + Math.random() * 10
})

let pointerDrag = null
let mouseInteractive = true
let pendingPointerEvent = null
let pointerHitTestFrame = null

function setMouseInteractive(interactive) {
  if (mouseInteractive === interactive) return
  mouseInteractive = interactive
  window.desktopPet?.setMouseInteractive(interactive)
}

function pointerHitsModel(clientX, clientY) {
  if (!vrm || !visibleModelBounds) return false
  const width = Math.max(visibleModelBounds.right - visibleModelBounds.left, 1)
  const height = Math.max(visibleModelBounds.bottom - visibleModelBounds.top, 1)
  const centerX = visibleModelBounds.left + width / 2
  const centerY = visibleModelBounds.top + height / 2
  const normalizedX = (clientX - centerX) / (width * 0.52)
  const normalizedY = (clientY - centerY) / (height * 0.52)
  return normalizedX * normalizedX + normalizedY * normalizedY <= 1
}

function updatePointerInteractivity(event) {
  pendingPointerEvent = { clientX: event.clientX, clientY: event.clientY }
  if (pointerHitTestFrame !== null) return
  pointerHitTestFrame = requestAnimationFrame(() => {
    pointerHitTestFrame = null
    if (pointerDrag || !pendingPointerEvent) {
      setMouseInteractive(true)
      return
    }
    const { clientX, clientY } = pendingPointerEvent
    pendingPointerEvent = null
    const hoveredElement = document.elementFromPoint(clientX, clientY)
    const overControls = Boolean(hoveredElement?.closest('.pet-manager, .asset-panel button, .asset-panel input, .asset-panel select'))
    setMouseInteractive(overControls || pointerHitsModel(clientX, clientY))
  })
}

window.addEventListener('mousemove', updatePointerInteractivity, { passive: true })
window.addEventListener('mouseleave', () => {
  if (!pointerDrag && vrm) setMouseInteractive(false)
})

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !pointerHitsModel(event.clientX, event.clientY)) return
  setMouseInteractive(true)
  event.preventDefault()
  renderer.domElement.setPointerCapture(event.pointerId)
  const dragState = {
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    dragging: false,
  }
  pointerDrag = dragState
  window.desktopPet?.beginDrag(event.screenX, event.screenY)
})

renderer.domElement.addEventListener('pointermove', (event) => {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return
  const distance = Math.hypot(event.screenX - pointerDrag.startX, event.screenY - pointerDrag.startY)
  if (!pointerDrag.dragging && distance >= 3) {
    pointerDrag.dragging = true
    stopRoaming(false)
    if (loadedMotionIndices.has(DRAG_INDEX)) selectVrmaMotion(DRAG_INDEX, 0.08, 'drag')
    else useProceduralMotion('drag', 0.08)
  }
})

function finishPointerInteraction(event) {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return
  const wasDragging = pointerDrag.dragging
  pointerDrag = null
  window.desktopPet?.endDrag()
  if (renderer.domElement.hasPointerCapture(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId)
  }
  if (wasDragging) {
    stopRoaming(false)
    landingPulse = 1
    landingElapsed = 0
    idlePose = 'neutral'
    if (loadedMotionIndices.has(LAND_INDEX)) selectVrmaMotion(LAND_INDEX, 0.08, 'release')
    else selectIdleMotion(0.08)
  } else {
    playRandomClickInteraction()
  }
}

renderer.domElement.addEventListener('pointerup', finishPointerInteraction)
renderer.domElement.addEventListener('pointercancel', finishPointerInteraction)
window.addEventListener('pointerup', finishPointerInteraction)
window.addEventListener('pointercancel', finishPointerInteraction)

function abortPointerInteraction() {
  if (!pointerDrag) return
  const wasDragging = pointerDrag.dragging
  pointerDrag = null
  window.desktopPet?.endDrag()
  if (wasDragging) {
    landingElapsed = 0
    landingPulse = 1
    idlePose = 'neutral'
    if (loadedMotionIndices.has(LAND_INDEX)) selectVrmaMotion(LAND_INDEX, 0.08, 'release')
    else selectIdleMotion(0.08)
  }
}

renderer.domElement.addEventListener('lostpointercapture', abortPointerInteraction)
window.addEventListener('blur', abortPointerInteraction)
window.addEventListener('beforeunload', abortPointerInteraction)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) abortPointerInteraction()
})

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLElement && event.target.closest('input, select, button')) return

  if (event.code === 'Space') {
    event.preventDefault()
    if (!event.repeat) {
      if (currentMotionRole === 'dance') {
        manualDanceOverride = false
        isDancing = false
        selectIdleMotion()
      } else {
        manualDanceOverride = true
        stopRoaming(false)
        isDancing = true
        idlePose = 'neutral'
        const firstDance = availableMotionIndices(DANCE_INDICES)[0]
        if (firstDance != null) selectVrmaMotion(firstDance, 0.3, 'dance')
      }
    }
    return
  }

  if (event.code === 'KeyM') {
    event.preventDefault()
    if (!event.repeat) {
      musicDanceMuted = !musicDanceMuted
      manualDanceOverride = false
      if (musicDanceMuted || !spotifyIsPlaying || petDanceMode === 'off') {
        isDancing = false
        setIdlePose('neutral', 0.3)
      } else {
        isDancing = true
        stopRoaming(false)
        danceShuffleBag = []
        nextAutoDanceSelectionAt = 0
        selectAutomaticDance(animationElapsed)
      }
      console.log(`Music dance ${musicDanceMuted ? 'muted; idle enabled' : 'enabled'}`)
    }
    return
  }

  if (/^Digit[1-9]$/.test(event.code)) {
    event.preventDefault()
    if (!event.repeat) {
      stopRoaming(false)
      const index = availableMotionIndices(CLICK_INTERACTION_INDICES)[Number(event.code.slice(-1)) - 1]
      if (index != null) selectVrmaMotion(index, 0.2, 'interaction')
    }
    return
  }

  const danceShortcutOffset = { KeyZ: 0, KeyX: 1, KeyC: 2 }[event.code]
  if (danceShortcutOffset != null) {
    event.preventDefault()
    if (!event.repeat) {
      manualDanceOverride = true
      isDancing = true
      idlePose = 'neutral'
      stopRoaming(false)
      const index = availableMotionIndices(DANCE_INDICES)[danceShortcutOffset]
      if (index != null) selectVrmaMotion(index, 0.3, 'dance')
    }
    return
  }

  if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
    event.preventDefault()
    if (!event.repeat) {
      manualDanceOverride = true
      isDancing = true
      idlePose = 'neutral'
      stopRoaming(false)
      const loadedDances = availableMotionIndices(DANCE_INDICES)
      const danceCount = loadedDances.length
      if (danceCount === 0) return
      const direction = event.code === 'BracketRight' ? 1 : -1
      const currentOffset = Math.max(0, loadedDances.indexOf(currentVrmaIndex))
      const offset = THREE.MathUtils.euclideanModulo(currentOffset + direction, danceCount)
      selectVrmaMotion(loadedDances[offset], 0.45, 'dance')
    }
    return
  }

  if (event.code === 'KeyI') {
    event.preventDefault()
    if (!event.repeat && !spotifyIsPlaying) {
      manualDanceOverride = false
      isDancing = false
      setIdlePose('neutral', 0.35)
    }
    return
  }

  if (event.code === 'KeyV') {
    event.preventDefault()
    if (!event.repeat && modelReady) {
      assetPanel.classList.toggle('hidden')
    }
    return
  }

  if (event.code === 'KeyG') {
    event.preventDefault()
    if (!event.repeat) window.desktopPet?.toggleGroupDance()
    return
  }

  if (event.code === 'KeyW') {
    event.preventDefault()
    if (!event.repeat) {
      const nextRoamingEnabled = !roamingEnabled
      roamingEnabled = nextRoamingEnabled
      if (!nextRoamingEnabled) stopRoaming(false)
      else nextRoamAt = animationElapsed + 1
      window.desktopPet?.setPetsRoamingEnabled([currentPetId], nextRoamingEnabled)
      console.log(`Desktop roaming ${nextRoamingEnabled ? 'enabled' : 'disabled'}`)
    }
    return
  }

  if (!['ArrowUp', 'ArrowDown', 'Digit0'].includes(event.code)) return
  event.preventDefault()
  if (event.repeat) return

  if (event.code === 'ArrowUp') targetBpm += 5
  if (event.code === 'ArrowDown') targetBpm -= 5
  if (event.code === 'Digit0') targetBpm = DANCE_CONFIG.bpm
  targetBpm = THREE.MathUtils.clamp(targetBpm, 60, 180)
  console.log(`Dance target BPM: ${targetBpm}`)
})
resize()

const clock = new THREE.Clock()
let animationElapsed = 0
renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), MAX_FRAME_DELTA)
  animationElapsed += delta
  const elapsed = animationElapsed

  if (vrm) {
    if (interactionPulse > 0) {
      interactionPulse = Math.max(0, interactionPulse - delta * 1.8)
      if (interactionPulse === 0 && currentMotionRole === 'interaction' && !currentVrmaAction) {
        setIdlePose('neutral', 0.25)
      }
    }
    let landingDrop = 0
    if (Number.isFinite(landingElapsed)) {
      landingElapsed += delta
      const impactAt = 0.12
      if (landingElapsed < impactAt) {
        const fall = landingElapsed / impactAt
        landingDrop = modelHeight * 0.08 * fall * fall
        landingPulse = 0
      } else {
        const impactTime = landingElapsed - impactAt
        const decay = Math.exp(-impactTime * 7)
        landingDrop = modelHeight * 0.08 * decay * Math.cos(impactTime * 22)
        landingPulse = decay
        if (impactTime > 0.75) {
          landingElapsed = Infinity
          landingPulse = 0
          landingDrop = 0
        }
      }
    }
    if (!spotifyIsPlaying || musicDanceMuted) audioMotionBoost = 1
    beatPulse = Math.max(0, beatPulse - delta * 6)
    audioAnalysisElapsed += delta
    if (
      spotifyIsPlaying
      && !musicDanceMuted
      && (petDanceMode === 'solo' || currentPetId === groupLeaderPetId)
      && systemAudioAnalyser
      && systemAudioData
      && audioAnalysisElapsed >= 1 / 30
    ) {
      audioAnalysisElapsed = 0
      systemAudioAnalyser.getByteFrequencyData(systemAudioData)
      let total = 0
      let bass = 0
      const bassBins = Math.min(8, systemAudioData.length)

      for (let index = 0; index < systemAudioData.length; index += 1) {
        total += systemAudioData[index]
        if (index < bassBins) bass += systemAudioData[index]
      }

      const level = total / systemAudioData.length / 255
      const bassLevel = bass / bassBins / 255
      audioMotionBoost = 1 + Math.min(level * 2 + bassLevel * 1.5, 0.9)

      bassBaseline += (bassLevel - bassBaseline) * 0.05
      const isBeat = (
        bassLevel > bassBaseline * 1.35 + 0.025
        && elapsed - lastDetectedBeatAt > 0.22
      )

      if (isBeat) {
        const beatInterval = elapsed - lastDetectedBeatAt
        lastDetectedBeatAt = elapsed
        beatPulse = 1

        if (beatInterval >= 0.25 && beatInterval <= 1.2) {
          let detectedBpm = 60 / beatInterval
          while (detectedBpm < 80) detectedBpm *= 2
          while (detectedBpm > 160) detectedBpm /= 2
          detectedBeatBpms.push(detectedBpm)
          if (detectedBeatBpms.length > 8) detectedBeatBpms.shift()

          if (detectedBeatBpms.length >= 4) {
            const sortedBpms = [...detectedBeatBpms].sort((a, b) => a - b)
            const middle = Math.floor(sortedBpms.length / 2)
            const stableBpm = sortedBpms.length % 2 === 0
              ? (sortedBpms[middle - 1] + sortedBpms[middle]) / 2
              : sortedBpms[middle]
            targetBpm += (stableBpm - targetBpm) * 0.15

            const fullTurn = Math.PI * 2
            const beatPhase = THREE.MathUtils.euclideanModulo(danceBeat, fullTurn)
            const phaseError = beatPhase > Math.PI
              ? fullTurn - beatPhase
              : -beatPhase
            danceBeat += phaseError * DANCE_CONFIG.beatPhaseCorrection

            if (elapsed - lastDetectedBpmLogAt >= 5) {
              lastDetectedBpmLogAt = elapsed
              console.log(`Detected music BPM: ${Math.round(targetBpm)}`)
            }
          }
        }
      }
    }

    currentBpm = THREE.MathUtils.damp(currentBpm, targetBpm, 5, delta)
    danceBeat += delta * (currentBpm / 60) * Math.PI * 2
    selectAutomaticDance(elapsed)

    if (
      (!spotifyIsPlaying || musicDanceMuted || petDanceMode === 'off')
      && !manualDanceOverride
    ) {
      const isIdleMotion = ['idle', 'sit', 'sleep'].includes(currentMotionRole)
      if (!isRoaming && isIdleMotion && elapsed >= nextIdlePoseAt) {
        setIdlePose('neutral')
      }
      if (roamingEnabled && !isRoaming && currentMotionRole === 'idle' && idlePose === 'neutral' && elapsed >= nextRoamAt) startRoaming()
      if (isRoaming && elapsed >= roamStopAt) stopRoaming(false)
    }

    const blendStep = delta / DANCE_CONFIG.returnSeconds
    danceBlend = THREE.MathUtils.clamp(
      danceBlend + blendStep,
      0,
      1,
    )

    // Start every frame from the model's stable rest pose. Idle clips omit
    // head tracks, so without this reset the procedural head motion would
    // multiply onto the previous frame and accumulate into uncontrolled spins.
    danceBoneList.forEach(({ bone, baseQuaternion }) => {
      bone.quaternion.copy(baseQuaternion)
    })

    const beat = danceBeat
    const sway = Math.sin(beat)
    const opposite = Math.sin(beat + Math.PI)
    const slowBodySway = Math.sin(beat / 4)
    const slowHeadTurn = Math.sin(beat / 6)
    const slowHeadNod = Math.sin(beat / 5 + 0.8)
    const slowHeadTilt = Math.sin(beat / 8 + 1.4)
    const phrase = beat / 8
    const armPhrase = 0.5 - Math.cos(phrase) * 0.5
    const stepPhrase = 0.5 + Math.sin(phrase - Math.PI) * 0.5
    const armLiftScale = 0.75 + armPhrase * 0.5
    const stepScale = 0.8 + stepPhrase * 0.4
    const kneeScale = 0.75 + armPhrase * 0.5
    const idleWeight = ['idle', 'sit', 'sleep'].includes(currentMotionRole)
      ? 1
      : (currentVrmaAction ? 0 : 1 - danceBlend)
    const idleBreath = Math.sin(elapsed * 0.8)
    const idleHeadTurn = Math.sin(elapsed * 0.4)

    vrm.scene.position.copy(originalScenePosition)
    if (!currentVrmaAction) {
      vrm.scene.position.y += (
        Math.sin(beat / 2) * DANCE_CONFIG.bounce * danceBlend * audioMotionBoost
      )
    }
    vrm.scene.position.y += idleBreath * DANCE_CONFIG.idleBounce * idleWeight
    vrm.scene.position.y -= landingDrop
    vrm.scene.quaternion.copy(originalSceneQuaternion)
    facingYaw = THREE.MathUtils.damp(facingYaw, targetFacingYaw, 8, delta)
    facingRotation.setFromAxisAngle(facingAxis, facingYaw)
    vrm.scene.quaternion.multiply(facingRotation)

    if (currentVrmaAction && vrmaMixer) {
      const vrmaSpeed = (
        spotifyIsPlaying
        && petDanceMode !== 'off'
        && !musicDanceMuted
      )
        ? currentBpm / currentVrmaReferenceBpm
        : 1
      currentVrmaAction.paused = false
      vrmaMixer.update(delta * vrmaSpeed)
      vrm.scene.position.copy(originalScenePosition)
    } else {
      if (currentMotionRole === 'walk') {
        const walkBeat = elapsed * 8
        const leftStep = Math.sin(walkBeat)
        const rightStep = Math.sin(walkBeat + Math.PI)
        applyDanceRotation('leftUpperArm', rightStep * 0.28, 0, 0.08, false)
        applyDanceRotation('rightUpperArm', leftStep * 0.28, 0, -0.08, false)
        applyDanceRotation('leftUpperLeg', leftStep * 0.38, 0, 0, false)
        applyDanceRotation('rightUpperLeg', rightStep * 0.38, 0, 0, false)
        applyDanceRotation('leftLowerLeg', Math.max(0, -leftStep) * 0.55, 0, 0, false)
        applyDanceRotation('rightLowerLeg', Math.max(0, -rightStep) * 0.55, 0, 0, false)
      } else if (currentMotionRole !== 'drag' && currentMotionRole !== 'interaction') {
        applyDanceRotation('hips', 0, 0, slowBodySway * DANCE_CONFIG.hipsSway, false)
        applyDanceRotation(
          danceBones.chest ? 'chest' : 'spine', 0, 0,
          -slowBodySway * DANCE_CONFIG.torsoCounterSway, false,
        )
        applyDanceRotation(
          'head',
          slowHeadNod * DANCE_CONFIG.headNod,
          slowHeadTurn * DANCE_CONFIG.headTurn,
          slowHeadTilt * DANCE_CONFIG.headTilt,
          false,
        )
        applyDanceRotation('leftShoulder', 0, 0, sway * DANCE_CONFIG.shoulderLift)
        applyDanceRotation('rightShoulder', 0, 0, sway * DANCE_CONFIG.shoulderLift)
        applyDanceRotation('leftUpperArm', Math.sin(beat + 0.35) * DANCE_CONFIG.upperArmSwing, 0, DANCE_CONFIG.upperArmLiftBase + sway * DANCE_CONFIG.upperArmLift * armLiftScale)
        applyDanceRotation('rightUpperArm', Math.sin(beat + Math.PI + 0.35) * DANCE_CONFIG.upperArmSwing, 0, -(DANCE_CONFIG.upperArmLiftBase + opposite * DANCE_CONFIG.upperArmLift * armLiftScale))
        applyDanceRotation('leftLowerArm', 0, 0, -(DANCE_CONFIG.lowerArmBendBase + (sway + 1) * DANCE_CONFIG.lowerArmBend))
        applyDanceRotation('rightLowerArm', 0, 0, DANCE_CONFIG.lowerArmBendBase + (opposite + 1) * DANCE_CONFIG.lowerArmBend)
        applyDanceRotation('leftUpperLeg', Math.sin(beat + 0.15) * DANCE_CONFIG.upperLegSwing * stepScale, 0, sway * DANCE_CONFIG.upperLegSway)
        applyDanceRotation('rightUpperLeg', Math.sin(beat + Math.PI + 0.15) * DANCE_CONFIG.upperLegSwing * stepScale, 0, opposite * DANCE_CONFIG.upperLegSway)
        applyDanceRotation('leftLowerLeg', DANCE_CONFIG.kneeBendBase + (sway + 1) * DANCE_CONFIG.kneeBend * kneeScale, 0, 0)
        applyDanceRotation('rightLowerLeg', DANCE_CONFIG.kneeBendBase + (opposite + 1) * DANCE_CONFIG.kneeBend * kneeScale, 0, 0)
      }
    }

    if (currentMotionRole === 'interaction' && interactionPulse > 0) {
      const wave = Math.sin((1 - interactionPulse) * Math.PI * 8)
      if (interactionVariant === 0) {
        applyAdditionalRotation('rightUpperArm', -0.35, 0, -1.15, 1)
        applyAdditionalRotation('rightLowerArm', 0, 0, 0.55 + wave * 0.3, 1)
      } else if (interactionVariant === 1) {
        applyAdditionalRotation('leftUpperArm', -0.2, 0, 0.72, 1)
        applyAdditionalRotation('rightUpperArm', -0.2, 0, -0.72, 1)
        applyAdditionalRotation('head', -0.08 + wave * 0.05, 0, 0, 1)
      } else {
        vrm.scene.position.y += Math.sin((1 - interactionPulse) * Math.PI) * modelHeight * 0.035
        applyAdditionalRotation('leftUpperArm', -0.5, 0, 0.42, 1)
        applyAdditionalRotation('rightUpperArm', -0.5, 0, -0.42, 1)
      }
    }

    if (currentMotionRole === 'drag') {
      applyAdditionalRotation('leftUpperArm', -0.12, 0, 0.38, 1)
      applyAdditionalRotation('rightUpperArm', -0.12, 0, -0.38, 1)
      applyAdditionalRotation('leftLowerArm', 0, 0, -0.18, 1)
      applyAdditionalRotation('rightLowerArm', 0, 0, 0.18, 1)
      applyAdditionalRotation('leftUpperLeg', 0.18, 0, 0.06, 1)
      applyAdditionalRotation('rightUpperLeg', 0.24, 0, -0.06, 1)
      applyAdditionalRotation('leftLowerLeg', 0.22, 0, 0, 1)
      applyAdditionalRotation('rightLowerLeg', 0.28, 0, 0, 1)
    }

    if (landingPulse > 0) {
      const landingWeight = landingPulse
      applyAdditionalRotation('hips', landingWeight * 0.18, 0, 0, 1)
      applyAdditionalRotation('spine', landingWeight * 0.12, 0, 0, 1)
      applyAdditionalRotation('leftUpperArm', -landingWeight * 0.32, 0, landingWeight * 0.28, 1)
      applyAdditionalRotation('rightUpperArm', -landingWeight * 0.32, 0, -landingWeight * 0.28, 1)
      applyAdditionalRotation('leftUpperLeg', landingWeight * 0.62, 0, 0, 1)
      applyAdditionalRotation('rightUpperLeg', landingWeight * 0.62, 0, 0, 1)
      applyAdditionalRotation('leftLowerLeg', -landingWeight * 1.05, 0, 0, 1)
      applyAdditionalRotation('rightLowerLeg', -landingWeight * 1.05, 0, 0, 1)
    }

    applyAdditionalRotation('chest', idleBreath * DANCE_CONFIG.idleBreath, 0, 0, idleWeight)
    if (!danceBones.chest) {
      applyAdditionalRotation('spine', idleBreath * DANCE_CONFIG.idleBreath, 0, 0, idleWeight)
    }
    applyAdditionalRotation(
      'head',
      (DANCE_CONFIG.idleHeadPitch + idleBreath * DANCE_CONFIG.idleHeadNod) * idleWeight,
      idleHeadTurn * DANCE_CONFIG.idleHeadTurn * idleWeight,
      0,
      1,
    )

    vrm.update(delta)
  }

  renderer.render(scene, camera)
})
