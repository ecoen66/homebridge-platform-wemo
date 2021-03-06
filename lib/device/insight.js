/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const helpers = require('./../helpers')
const util = require('util')
module.exports = class deviceStandard {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.lastConsumption = 0
    const self = this
    this.eveCurrentConsumption = function () {
      self.Characteristic.call(this, 'Current Consumption', 'E863F10D-079E-48FF-8F27-9C2605A29F52')
      this.setProps({
        format: self.Characteristic.Formats.UINT16,
        unit: 'W',
        maxValue: 100000,
        minValue: 0,
        minStep: 1,
        perms: [self.Characteristic.Perms.READ, self.Characteristic.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.eveTotalConsumption = function () {
      self.Characteristic.call(this, 'Total Consumption', 'E863F10C-079E-48FF-8F27-9C2605A29F52')
      this.setProps({
        format: self.Characteristic.Formats.FLOAT,
        unit: 'kWh',
        maxValue: 100000000000,
        minValue: 0,
        minStep: 0.01,
        perms: [self.Characteristic.Perms.READ, self.Characteristic.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.eveResetTotal = function () {
      self.Characteristic.call(this, 'Reset Total', 'E863F112-079E-48FF-8F27-9C2605A29F52')
      this.setProps({
        format: self.Characteristic.Formats.UINT32,
        perms: [self.Characteristic.Perms.READ, self.Characteristic.Perms.NOTIFY, self.Characteristic.Perms.WRITE]
      })
      this.value = this.getDefaultValue()
    }
    util.inherits(this.eveCurrentConsumption, this.Characteristic)
    util.inherits(this.eveTotalConsumption, this.Characteristic)
    util.inherits(this.eveResetTotal, this.Characteristic)
    this.eveCurrentConsumption.UUID = 'E863F10D-079E-48FF-8F27-9C2605A29F52'
    this.eveTotalConsumption.UUID = 'E863F10C-079E-48FF-8F27-9C2605A29F52'
    this.eveResetTotal.UUID = 'E863F112-079E-48FF-8F27-9C2605A29F52'
    let service
    if (!(service = accessory.getService(this.Service.Outlet))) {
      accessory.addService(this.Service.Outlet)
      service = accessory.getService(this.Service.Outlet)
      service.addCharacteristic(this.eveCurrentConsumption)
      service.addCharacteristic(this.eveTotalConsumption)
      service.addCharacteristic(this.eveResetTotal)
    }
    service
      .getCharacteristic(this.Characteristic.On)
      .on('set', (value, callback) => this.internalUpdate(value, callback))
    service
      .getCharacteristic(this.eveResetTotal)
      .on('set', (value, callback) => {
        callback()
        service.updateCharacteristic(this.eveTotalConsumption, 0)
      })
    this.accessory = accessory
    this.client = accessory.client
    this.client.on('error', err => this.log.warn('[%s] reported error:\n%s.', accessory.displayName, err))
    this.client.on('binaryState', value => this.externalSwitchUpdate(parseInt(value)))
    this.client.on('insightParams', (state, power, data) => this.externalInsightUpdate(parseInt(state), parseInt(power), data))
  }

  async internalUpdate (value, callback) {
    const service = this.accessory.getService(this.Service.Outlet)
    const prevStateSwitch = service.getCharacteristic(this.Characteristic.On).value
    const prevStateOInUse = service.getCharacteristic(this.Characteristic.OutletInUse).value
    callback()
    try {
      await this.client.soapAction('urn:Belkin:service:basicevent:1', 'SetBinaryState', { BinaryState: value ? 1 : 0 })
      if (!this.disableDeviceLogging) this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      if (!value) {
        service.updateCharacteristic(this.Characteristic.OutletInUse, false)
        if (!this.disableDeviceLogging) this.log('[%s] setting outlet-in-use to [no].', this.accessory.displayName)
        service.updateCharacteristic(this.eveCurrentConsumption, 0)
        if (!this.disableDeviceLogging) this.log('[%s] setting consumption to [0W].', this.accessory.displayName)
      }
    } catch (err) {
      this.log.warn('[%s] setting state and outlet-in-use to [%s] error:\n%s', this.accessory.displayName, value ? 'on' : 'off', err)
      this.log.warn('[%s] Reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      service.updateCharacteristic(this.Characteristic.On, prevStateSwitch)
      service.updateCharacteristic(this.Characteristic.OutletInUse, prevStateOInUse)
    }
  }

  externalSwitchUpdate (value) {
    try {
      value = value !== 0
      const service = this.accessory.getService(this.Service.Outlet)
      const switchState = service.getCharacteristic(this.Characteristic.On).value
      if (switchState !== value) {
        service.updateCharacteristic(this.Characteristic.On, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
      if (!value) {
        this.externalOutletInUseUpdate(0)
        this.externalConsumptionUpdate(0)
      }
    } catch (err) {
      this.log.warn('[%s] updating state [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
    }
  }

  externalInsightUpdate (value, power, data) {
    this.externalSwitchUpdate(value)
    this.externalOutletInUseUpdate(value)
    this.externalConsumptionUpdate(power)
    this.externalTotalConsumptionUpdate(data.TodayConsumed, data.TodayONTime)
  }

  externalOutletInUseUpdate (value) {
    try {
      value = value !== 0
      const service = this.accessory.getService(this.Service.Outlet)
      if (value !== service.getCharacteristic(this.Characteristic.OutletInUse).value) {
        service.updateCharacteristic(this.Characteristic.OutletInUse, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating outlet-in-use [%s].', this.accessory.displayName, value ? 'yes' : 'no')
      }
    } catch (err) {
      this.log.warn('[%s] updating outlet-in-use [%s] error - %s', this.accessory.displayName, value ? 'yes' : 'no', err)
    }
  }

  externalConsumptionUpdate (power) {
    const consumption = Math.round(power / 1000)
    try {
      if (consumption !== this.lastConsumption) {
        this.accessory.getService(this.Service.Outlet).updateCharacteristic(this.eveCurrentConsumption, consumption)
        this.lastConsumption = consumption
        if (!this.disableDeviceLogging) this.log('[%s] updating consumption to [%sW].', this.accessory.displayName, consumption)
      }
    } catch (err) {
      this.log.warn('[%s] updating consumption to [%sW] error - %s', this.accessory.displayName, consumption, err)
    }
  }

  externalTotalConsumptionUpdate (raw, raw2) {
    // raw = data.TodayConsumed in mW minutes; raw2 = data.TodayONTime in seconds
    const value = Math.round(raw / (1000 * 60)) // convert to Wh, raw is total mW minutes
    try {
      const kWh = value / 1000 // convert to kWh
      const onHours = Math.round(raw2 / 36) / 100 // convert to hours
      const service = this.accessory.getService(this.Service.Outlet)
      const totalConsumption = service.getCharacteristic(this.eveTotalConsumption).value
      if (totalConsumption !== value) {
        service.updateCharacteristic(this.eveTotalConsumption, kWh)
        if (!this.disableDeviceLogging) this.log('[%s] updating total on-time - %s hours.', this.accessory.displayName, onHours)
        if (!this.disableDeviceLogging) this.log('[%s] updating total consumption - %s kWh.', this.accessory.displayName, kWh)
      }
    } catch (err) {
      this.log.warn('[%s] updating total consumption error - %s', this.accessory.displayName, err)
    }
  }
}
