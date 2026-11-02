import { describe, expect, it } from 'vitest'
import { deliveryNote, isDeliverable, normalizeRegion, placeFromChoice, placeFromGeocode, readStoredPlace, storePlace } from '../deliveryPlace.js'

const memory = () => {
  const data = new Map()
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }
}

describe('deliveryPlace', () => {
  it('reads Greater Accra as "Accra" and matches regions however OpenStreetMap writes them', () => {
    expect(normalizeRegion('Greater Accra Region')).toBe('Greater Accra')
    expect(normalizeRegion('ashanti region')).toBe('Ashanti')
    expect(normalizeRegion('Bono-East Region')).toBe('Bono East')
    expect(normalizeRegion('Lagos')).toBeNull()
    expect(placeFromGeocode({ countryCode: 'GH', state: 'Greater Accra Region' })).toMatchObject({ name: 'Accra', region: 'Greater Accra', country: 'Ghana' })
  })

  it('names the country outside Ghana', () => {
    expect(placeFromGeocode({ countryCode: 'GB', state: 'England' })).toMatchObject({ name: 'United Kingdom', region: null, countryCode: 'GB' })
  })

  it('does not guess a region it cannot match in Ghana', () => {
    expect(placeFromGeocode({ countryCode: 'GH', state: '' })).toBeNull()
    expect(placeFromGeocode(null)).toBeNull()
  })

  it('door-to-door delivery is Ashanti only, and the note says so plainly', () => {
    const ashanti = placeFromChoice({ countryCode: 'GH', region: 'Ashanti' })
    const accra = placeFromChoice({ countryCode: 'GH', region: 'Greater Accra' })
    const abroad = placeFromChoice({ countryCode: 'NG' })
    expect(isDeliverable(ashanti)).toBe(true)
    expect(isDeliverable(accra)).toBe(false)
    expect(isDeliverable(abroad)).toBe(false)
    expect(deliveryNote(ashanti)).toMatch(/door-to-door in Ashanti/)
    expect(deliveryNote(accra)).toMatch(/Ashanti Region only.*Accra/)
    expect(deliveryNote(abroad)).toMatch(/Ghana only.*Nigeria/)
    expect(deliveryNote(null)).toBe('')
    for (const place of [ashanti, accra, abroad]) expect(deliveryNote(place)).not.toMatch(/\d+\s*(day|hour)|GH₵|free/i)
  })

  it('stores only the choice and ignores a damaged value', () => {
    const storage = memory()
    expect(readStoredPlace(storage)).toBeNull()
    storePlace(placeFromChoice({ countryCode: 'GH', region: 'Greater Accra' }), storage)
    expect(readStoredPlace(storage)).toMatchObject({ name: 'Accra' })
    storage.setItem('ashantihub.deliverTo', '{not json')
    expect(readStoredPlace(storage)).toBeNull()
    storage.setItem('ashantihub.deliverTo', JSON.stringify({ countryCode: 'GH', region: 'Atlantis' }))
    expect(readStoredPlace(storage)).toBeNull()
    storePlace(null, storage)
    expect(storage.getItem('ashantihub.deliverTo')).toBeNull()
  })
})
