import assert from 'node:assert/strict'
import test from 'node:test'
import { contrastRatio, recommendClosestPaletteSwatch } from './wcagContrast.ts'

test('recommends the nearest approved swatch that passes AA normal-text contrast', () => {
  const palette = ['#777777', '#666666', '#000000', '#EEEEEE']
  const recommendation = recommendClosestPaletteSwatch('#777777', '#FFFFFF', palette, 4.5)

  assert.deepEqual(recommendation, {
    color: '#666666',
    ratio: contrastRatio('#666666', '#FFFFFF'),
  })
  assert.ok(palette.includes(recommendation.color))
  assert.ok(recommendation.ratio >= 4.5)
})

test('returns null when no approved palette swatch meets the requested threshold', () => {
  const recommendation = recommendClosestPaletteSwatch(
    '#777777',
    '#FFFFFF',
    ['#F0F0F0', '#EAEAEA', '#DDDDDD'],
    4.5,
  )

  assert.equal(recommendation, null)
})

test('uses the requested threshold, including the lower large-text AA target', () => {
  const recommendation = recommendClosestPaletteSwatch(
    '#777777',
    '#FFFFFF',
    ['#777777', '#666666', '#000000'],
    3,
  )

  assert.equal(recommendation?.color, '#777777')
  assert.ok((recommendation?.ratio ?? 0) >= 3)
})

test('ignores invalid palette entries and duplicate colours', () => {
  const recommendation = recommendClosestPaletteSwatch(
    '#777777',
    '#FFFFFF',
    ['not-a-colour', '#666666', '#666666', '#000000'],
    4.5,
  )

  assert.equal(recommendation?.color, '#666666')
})

test('returns null for invalid foreground or background values', () => {
  assert.equal(recommendClosestPaletteSwatch('777777', '#FFFFFF', ['#000000']), null)
  assert.equal(recommendClosestPaletteSwatch('#777777', 'white', ['#000000']), null)
})
