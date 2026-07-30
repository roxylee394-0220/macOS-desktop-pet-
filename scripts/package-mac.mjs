import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const projectRoot = resolve(import.meta.dirname, '..')
const electronApp = resolve(projectRoot, 'node_modules/electron/dist/Electron.app')
const releaseDirectory = resolve(projectRoot, 'release')
const isLocalBuild = process.argv.includes('--local')
const outputArgument = process.argv.slice(2).find((argument) => argument !== '--local')
const finalOutputApp = outputArgument
  ? resolve(outputArgument)
  : resolve(releaseDirectory, isLocalBuild ? 'macOS desktop pet 3.0.2.app' : 'macOS desktop pet 3.0.2.app')
const stagingDirectory = mkdtempSync(resolve(tmpdir(), 'vrm-desktop-pet-package-'))
const outputApp = resolve(stagingDirectory, 'macOS desktop pet 3.0.2.app')
const contents = resolve(outputApp, 'Contents')
const resources = resolve(contents, 'Resources')
const bundledApp = resolve(resources, 'app')
const plist = resolve(contents, 'Info.plist')

if (!existsSync(electronApp)) {
  throw new Error('Electron.app is missing. Run npm install first.')
}

mkdirSync(resolve(finalOutputApp, '..'), { recursive: true })
console.log('Creating VRM Desktop Pet.app…')
execFileSync('/usr/bin/ditto', ['--norsrc', '--noqtn', electronApp, outputApp])

renameSync(
  resolve(contents, 'MacOS/Electron'),
  resolve(contents, 'MacOS/macOS desktop pet'),
)

execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleExecutable macOS desktop pet', plist])
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleIdentifier app.vrmdesktoppet.desktop', plist])
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleName macOS desktop pet 3.0.2', plist])
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleDisplayName macOS desktop pet 3.0.2', plist])
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleShortVersionString 3.0.2', plist])
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleVersion 6', plist])
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :LSApplicationCategoryType public.app-category.entertainment', plist])
for (const key of ['NSBluetoothAlwaysUsageDescription', 'NSBluetoothPeripheralUsageDescription', 'NSCameraUsageDescription', 'NSAppTransportSecurity']) {
  try { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plist]) } catch {}
}
try {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Add :NSAppleEventsUsageDescription string VRM Desktop Pet reads whether Spotify is playing so it can switch between idle and dance.', plist])
} catch {}

mkdirSync(bundledApp, { recursive: true })
cpSync(resolve(projectRoot, 'dist'), resolve(bundledApp, 'dist'), { recursive: true })
if (!isLocalBuild) {
  rmSync(resolve(bundledApp, 'dist/model.vrm'), { force: true })
  rmSync(resolve(bundledApp, 'dist/animations'), { recursive: true, force: true })
}
rmSync(resolve(bundledApp, 'dist/.DS_Store'), { force: true })
cpSync(resolve(projectRoot, 'electron'), resolve(bundledApp, 'electron'), { recursive: true })
writeFileSync(resolve(bundledApp, 'package.json'), JSON.stringify({
  name: 'vrm-desktop-pet',
  productName: 'macOS desktop pet 3.0.2',
  version: '3.0.2',
  private: true,
  type: 'module',
  main: 'electron/main.js',
}, null, 2))

console.log('Applying an ad-hoc local signature…')
execFileSync('/usr/bin/xattr', ['-cr', outputApp])
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', outputApp], { stdio: 'inherit' })
rmSync(finalOutputApp, { recursive: true, force: true })
execFileSync('/usr/bin/ditto', ['--norsrc', '--noqtn', outputApp, finalOutputApp])
rmSync(stagingDirectory, { recursive: true, force: true })
console.log(`Created: ${finalOutputApp}`)
