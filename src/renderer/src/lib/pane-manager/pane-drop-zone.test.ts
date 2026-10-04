/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest'
import {
  hideDropOverlayRect,
  positionDropOverlayRect,
  resolveDropZone,
  resolveDropZoneRect
} from './pane-drop-zone'

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({})
  }
}

describe('resolveDropZone', () => {
  const paneRect = rect(100, 100, 200, 100)

  it.each([
    { x: 105, y: 150, zone: 'left' },
    { x: 295, y: 150, zone: 'right' },
    { x: 200, y: 102, zone: 'top' },
    { x: 200, y: 198, zone: 'bottom' }
  ] as const)('given a pointer nearest the $zone edge, it picks $zone', ({ x, y, zone }) => {
    expect(resolveDropZone(x, y, paneRect)).toBe(zone)
  })
})

describe('resolveDropZoneRect', () => {
  const paneRect = rect(100, 100, 200, 100)

  it.each([
    { zone: 'left', expected: { left: 100, top: 100, width: 100, height: 100 } },
    { zone: 'right', expected: { left: 200, top: 100, width: 100, height: 100 } },
    { zone: 'top', expected: { left: 100, top: 100, width: 200, height: 50 } },
    { zone: 'bottom', expected: { left: 100, top: 150, width: 200, height: 50 } }
  ] as const)('given the $zone zone, it covers that half of the pane', ({ zone, expected }) => {
    expect(resolveDropZoneRect(paneRect, zone)).toMatchObject({
      ...expected,
      right: expected.left + expected.width,
      bottom: expected.top + expected.height
    })
  })
})

describe('drop overlay visibility', () => {
  it('marks an overlay visible while positioned and clears the mark when hidden', () => {
    const overlay = document.createElement('div')

    positionDropOverlayRect(overlay, rect(10, 20, 100, 50))
    expect(overlay.style.display).toBe('')
    expect(overlay.hasAttribute('data-pane-drop-visible')).toBe(true)

    hideDropOverlayRect(overlay)
    expect(overlay.style.display).toBe('none')
    expect(overlay.hasAttribute('data-pane-drop-visible')).toBe(false)
  })
})
