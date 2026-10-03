import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const CONFIG_PATH = require.resolve('../electron-builder.config.cjs')

const MAC_CHANNEL_ENV = {
  ORCA_MAC_RELEASE: '',
  ORCA_MAC_HOURLY: '',
  ORCA_MAC_DAILY: '',
  ORCA_MAC_ADHOC: ''
}

function loadConfigWith(overrides) {
  const env = { ...MAC_CHANNEL_ENV, ...overrides }
  const saved = { ...process.env }
  Object.assign(process.env, env)
  delete require.cache[CONFIG_PATH]
  try {
    return require(CONFIG_PATH)
  } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = saved[key]
      }
    }
    delete require.cache[CONFIG_PATH]
  }
}

describe('electron-builder local app-only mac target', () => {
  afterEach(() => {
    delete require.cache[CONFIG_PATH]
  })

  it('builds only an unpacked app for the host architecture when requested', () => {
    const config = loadConfigWith({ ORCA_MAC_LOCAL_APP_ONLY: '1' })

    expect(config.mac.target).toEqual([{ target: 'dir', arch: [process.arch] }])
  })

  it('keeps the dmg and zip targets for both architectures by default', () => {
    const config = loadConfigWith({ ORCA_MAC_LOCAL_APP_ONLY: '' })

    expect(config.mac.target).toEqual([
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] }
    ])
  })

  it('ignores the request for release builds', () => {
    const config = loadConfigWith({ ORCA_MAC_LOCAL_APP_ONLY: '1', ORCA_MAC_RELEASE: '1' })

    expect(config.mac.target).toEqual([
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] }
    ])
  })
})
