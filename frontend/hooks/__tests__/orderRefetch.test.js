import { describe, expect, it } from 'vitest'
import { customerOrdersInterval } from '../useOrders.js'
import { ownerOrdersInterval } from '../useOwnerOrders.js'

describe('ownerOrdersInterval', () => {
  const door = { delivery_method: 'door_to_door', delivery_status: 'processing' }
  it('polls every 30 s while a door-to-door delivery is unfinished', () => {
    expect(ownerOrdersInterval({ results: [door] })).toBe(30000)
    expect(ownerOrdersInterval({ results: [{ delivery_status: 'delivered', rider_heading_here: true }] })).toBe(30000)
    expect(ownerOrdersInterval({ results: [{ delivery_method: 'store_pickup', delivery_status: 'delivered', pickup_code: '1357' }] })).toBe(30000)
    expect(ownerOrdersInterval({ results: [{ delivery_method: 'door_to_door', delivery_status: 'out_for_delivery' }] })).toBe(30000)
  })
  it('stops when everything is finished, store pickup, empty or not loaded', () => {
    expect(ownerOrdersInterval({ results: [{ ...door, delivery_status: 'delivered' }] })).toBe(false)
    expect(ownerOrdersInterval({ results: [{ delivery_method: 'store_pickup', delivery_status: 'processing' }] })).toBe(false)
    expect(ownerOrdersInterval({ results: [] })).toBe(false)
    expect(ownerOrdersInterval(undefined)).toBe(false)
    expect(ownerOrdersInterval({})).toBe(false)
  })
})

describe('customerOrdersInterval', () => {
  it.each(['assigned', 'accepted', 'at_pickup', 'picked_up', 'at_customer'])('polls while the assignment is %s', (s) => {
    expect(customerOrdersInterval([{ delivery_assignment_status: s }])).toBe(30000)
  })
  it.each(['delivered', 'confirmed', 'failed', null])('does not poll when the only assignment is %s', (s) => {
    expect(customerOrdersInterval([{ delivery_assignment_status: s }])).toBe(false)
  })
  it('does not poll for an empty or missing list', () => {
    expect(customerOrdersInterval([])).toBe(false)
    expect(customerOrdersInterval(undefined)).toBe(false)
  })
})
