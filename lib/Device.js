// Part of <http://miracle.systems/p/h5.modbus.inode> licensed under <MIT>

'use strict';

const modbus = require('h5.modbus');
const btHci = require('h5.bluetooth.hci');
const iNodeHci = require('h5.bluetooth.hci.inode');
const helpers = require('./helpers');

const EirDataType = btHci.EirDataType;
const DeviceModel = iNodeHci.DeviceModel;

class Device
{
  /**
   * @param {string} mac
   * @param {number} unit
   * @throws {Error} If the specified `mac` is not a valid MAC address, i.e. a string of six groups of two hexadecimal
   * digits optionally separated by colons (`:`) or hyphens (`-`).
   * @throws {Error} If the specified `unit` is not a valid MODBUS device unit, i.e. an integer between 0 and 255.
   */
  constructor(mac, unit)
  {
    if (unit < 0 || unit > 0xFF)
    {
      throw new Error(`Invalid unit. Expected an integer between 0 and 255, but got: ${unit}`);
    }

    /**
     * @type {string}
     */
    this.mac = helpers.prepareMacAddress(mac);

    /**
     * @type {number}
     */
    this.unit = unit;

    /**
     * @private
     * @type {number}
     */
    this.lastSeenAt = 0;

    /**
     * @private
     * @type {?Buffer}
     */
    this.buffer = null;

    /**
     * @readonly
     * @type {?DeviceModel}
     */
    this.model = null;

    /**
     * @private
     * @type {Object}
     */
    this.state = {};

    /**
     * @private
     * @type {Object}
     */
    this.changes = {};

    /**
     * @private
     * @type {function(this:Device, EirDataStructure)}
     */
    this.handleEirDataStructure = this.handleEirDataStructure.bind(this);
  }

  /**
   * @param {number} deviceTimeout
   * @returns {boolean}
   */
  isAvailable(deviceTimeout)
  {
    if (this.model === null)
    {
      return false;
    }

    if (Date.now() - this.lastSeenAt > deviceTimeout)
    {
      return false;
    }

    return true;
  }

  /**
   * @param {Request} request
   * @param {respondCallback} respond
   */
  handleModbusRequest(request, respond)
  {
    if (request.functionCode !== modbus.FunctionCode.ReadHoldingRegisters)
    {
      respond(modbus.ExceptionCode.IllegalFunctionCode);

      return;
    }

    this.handleReadHoldingRegistersRequest(request, respond);
  }

  /**
   * @param {AdvertisingReport} report
   */
  handleAdvertisingReport(report)
  {
    this.changeState('rssi', report.rssi);

    report.data.forEach(this.handleEirDataStructure);

    const changedKeys = Object.keys(this.changes);

    changedKeys.forEach(k =>
    {
      this.state[k] = this.changes[k];
      this.changes[k] = true;
    });

    if (changedKeys.length)
    {
      this.updateBuffer();

      this.changes = {};
    }

    this.lastSeenAt = Date.now();
  }

  /**
   * @private
   * @param {ReadHoldingRegistersRequest} request
   * @param {respondCallback} respond
   */
  handleReadHoldingRegistersRequest(request, respond)
  {
    if (request.startingIndex > this.buffer.length - 1 || request.endingIndex > this.buffer.length)
    {
      respond(modbus.ExceptionCode.IllegalDataAddress);

      return;
    }

    respond({
      data: this.buffer.slice(request.startingIndex, request.endingIndex)
    });
  }

  /**
   * @private
   * @param {EirDataStructure} eirDataStructure
   */
  handleEirDataStructure(eirDataStructure)
  {
    switch (eirDataStructure.type)
    {
      case EirDataType.LocalNameComplete:
        this.changeState('localName', eirDataStructure.value);
        break;

      case EirDataType.TxPowerLevel:
        this.changeState('txPowerLevel', eirDataStructure.value);
        break;

      case EirDataType.ManufacturerSpecificData:
        this.handleEirManufacturerSpecificData(eirDataStructure);
        break;
    }
  }

  /**
   * @private
   * @param {INodeDeviceMsd} msd
   */
  handleEirManufacturerSpecificData(msd)
  {
    this.changeModel(msd.model);
    this.changeState('rtto', msd.rtto);
    this.changeState('alarms', msd.alarms);

    switch (msd.model)
    {
      case DeviceModel.CareRelay:
        this.handleCareRelayMsd(msd);
        break;

      case DeviceModel.EnergyMeter:
        this.handleEnergyMeterMsd(msd);
        break;

      case DeviceModel.CareSensor1:
      case DeviceModel.CareSensor2:
      case DeviceModel.CareSensor3:
      case DeviceModel.CareSensor4:
      case DeviceModel.CareSensor5:
      case DeviceModel.CareSensor6:
      case DeviceModel.CareSensorT:
      case DeviceModel.CareSensorHT:
        this.handleCareSensorMsd(msd);
        break;
    }
  }

  /**
   * @private
   * @param {INodeCareRelayMsd} msd
   */
  handleCareRelayMsd(msd)
  {
    this.changeState('output', msd.output);
  }

  /**
   * @private
   * @param {INodeEnergyMeterMsd} msd
   */
  handleEnergyMeterMsd(msd)
  {
    this.changeState('sum', msd.sum);
    this.changeState('average', msd.average);
    this.changeState('unit', msd.unit);
    this.changeState('constant', msd.constant);
  }

  /**
   * @private
   * @param {INodeCareSensorMsd} msd
   */
  handleCareSensorMsd(msd)
  {
    this.changeState('time', msd.time);
    this.changeState('groups', msd.groups);
    this.changeState('batteryLevel', msd.batteryLevel);
    this.changeState('batteryVoltage', msd.batteryVoltage);
    this.changeState('input', msd.input);
    this.changeState('output', msd.output);
    this.changeState('position', msd.position);
    this.changeState('temperature', msd.temperature);
    this.changeState('humidity', msd.humidity);
  }

  /**
   * @private
   * @param {DeviceModel} newModel
   */
  changeModel(newModel)
  {
    if (newModel === this.model)
    {
      return;
    }

    this.model = newModel;
    this.changes = {
      model: newModel,
      rssi: this.changes.rssi,
      localName: this.changes.localName,
      txPowerLevel: this.changes.txPowerLevel
    };
  }

  /**
   * @private
   * @param {string} stateProperty
   * @param {*} newValue
   */
  changeState(stateProperty, newValue)
  {
    if (typeof newValue === 'undefined')
    {
      return;
    }

    const oldValue = this.state[stateProperty];

    if (newValue !== null && typeof newValue === 'object')
    {
      if (oldValue == null)
      {
        this.changes[stateProperty] = newValue;
      }
      else
      {
        this.changeStateObject(stateProperty, newValue, oldValue);
      }

      return;
    }

    if (newValue !== oldValue)
    {
      this.changes[stateProperty] = newValue;
    }
  }

  /**
   * @private
   * @param {string} stateProperty
   * @param {Object} newObject
   * @param {Object} oldObject
   */
  changeStateObject(stateProperty, newObject, oldObject)
  {
    const keys = Object.keys(newObject);

    for (let i = 0; i < keys.length; ++i)
    {
      const key = keys[i];

      if (newObject[key] !== oldObject[key])
      {
        this.changes[stateProperty] = newObject;

        break;
      }
    }
  }

  /**
   * @private
   */
  updateBuffer() // eslint-disable-line complexity
  {
    const state = this.state;
    const changes = this.changes;
    const modelChanged = changes.model;

    if (modelChanged)
    {
      this.resetBuffer();
    }

    const buffer = this.buffer;

    if (modelChanged || changes.localName)
    {
      buffer.write((state.localName || '').substring(0, 16), 6);
    }

    if (modelChanged || changes.rssi)
    {
      buffer.writeInt16BE(typeof state.rssi === 'number' ? state.rssi : 0x00FF, 24, true);
    }

    if (modelChanged || changes.txPowerLevel)
    {
      buffer.writeInt16BE(typeof state.txPowerLevel === 'number' ? state.txPowerLevel : 0x00FF, 26, true);
    }

    if (modelChanged || changes.rtto)
    {
      buffer.writeUInt16BE(state.rtto ? 1 : 0, 28, true);
    }

    if (modelChanged || changes.alarms)
    {
      this.writeAlarms(buffer, 30);
    }

    switch (this.model)
    {
      case DeviceModel.CareRelay:
        this.writeCareRelay();
        break;

      case DeviceModel.EnergyMeter:
        this.writeEnergyMeter();
        break;

      case DeviceModel.CareSensor1:
      case DeviceModel.CareSensor2:
      case DeviceModel.CareSensor3:
      case DeviceModel.CareSensor4:
      case DeviceModel.CareSensor5:
      case DeviceModel.CareSensor6:
      case DeviceModel.CareSensorT:
      case DeviceModel.CareSensorHT:
        this.writeCareSensor();
        break;
    }
  }

  resetBuffer()
  {
    let bufferLength = 6 // MAC
      + 16 // Local name
      + 2 // Model
      + 2 // RSSI
      + 2 // TX power level
      + 2 // RTTO
      + 2; // Alarms

    switch (this.model)
    {
      case DeviceModel.CareRelay:
        bufferLength += 2; // Flags
        break;

      case DeviceModel.EnergyMeter:
        bufferLength += 2 // Flags
          + 2 // Temperature
          + 2 // Humidity
          + 2 // x
          + 2 // y
          + 2 // z
          + 2 // Battery level
          + 2 // Battery voltage
          + 2 // Groups
          + 4; // Time
        break;

      case DeviceModel.CareSensor1:
      case DeviceModel.CareSensor2:
      case DeviceModel.CareSensor3:
      case DeviceModel.CareSensor4:
      case DeviceModel.CareSensor5:
      case DeviceModel.CareSensor6:
      case DeviceModel.CareSensorT:
      case DeviceModel.CareSensorHT:
        bufferLength += 2 // Constant
          + 2 // Unit
          + 4 // Total value
          + 4; // Average value
        break;
    }

    this.buffer = new Buffer(bufferLength).fill(0);

    this.mac
      .split(':')
      .map(hex => parseInt(hex, 16))
      .forEach((byte, i) => { this.buffer[i] = byte; });

    this.buffer.writeUInt16BE(this.model, 22, true);
  }

  /**
   * @private
   * @param {Buffer} buffer
   * @param {number} i
   */
  writeAlarms(buffer, i)
  {
    const alarms = this.state.alarms || {};
    const bytes = 0
      | (alarms.lowBattery ? 1 : 0)
      | (alarms.moveAccelerometer ? 2 : 0)
      | (alarms.levelAccelerometer ? 4 : 0)
      | (alarms.levelTemperature ? 8 : 0)
      | (alarms.levelHumidity ? 16 : 0)
      | (alarms.contactChange ? 32 : 0)
      | (alarms.moveStopped ? 64 : 0)
      | (alarms.moveGTimer ? 128 : 0)
      | (alarms.levelAccelerometerChange ? 256 : 0)
      | (alarms.levelMagnetChange ? 512 : 0)
      | (alarms.levelMagnetTimer ? 1024 : 0);

    buffer.writeUInt16BE(bytes, i);
  }

  /**
   * @private
   */
  writeCareRelay()
  {
    this.buffer.writeUInt16BE(0 | (this.state.output ? 2 : 0), 32, true);
  }

  /**
   * @private
   */
  writeEnergyMeter()
  {
    const state = this.state;
    const changes = this.changes;
    const modelChanged = changes.model;

    if (modelChanged || changes.constant)
    {
      this.buffer.writeUInt16BE(state.constant, 32, true);
    }

    if (modelChanged || changes.unit)
    {
      this.buffer.writeUInt16BE(state.unit, 34, true);
    }

    if (modelChanged || changes.sum)
    {
      this.buffer.writeUInt32BE(Math.round(state.sum * 100), 36, true);
    }

    if (modelChanged || changes.average)
    {
      this.buffer.writeUInt32BE(Math.round(state.average * 100), 40, true);
    }
  }

  /**
   * @private
   */
  writeCareSensor() // eslint-disable-line complexity
  {
    const state = this.state;
    const changes = this.changes;
    const modelChanged = changes.model;
    const position = state.position || {};

    const flags = 0
      | ((state.input || state.magneticFieldDirection) ? 1 : 0)
      | (state.output ? 2 : 0)
      | (position.motion ? 4 : 0);

    this.buffer.writeUInt16BE(flags, 32, true);

    if (modelChanged || changes.temperature)
    {
      const temperature = typeof state.temperature === 'number' ? state.temperature : 0x00FF;

      this.buffer.writeInt16BE(Math.round(temperature * 100), 34, true);
    }

    if (modelChanged || changes.humidity)
    {
      const humidity = typeof state.humidity === 'number' ? state.humidity : 0x00FF;

      this.buffer.writeUInt16BE(Math.round(humidity * 100), 36, true);
    }

    if ((modelChanged || changes.magneticField) && typeof state.magneticField === 'number')
    {
      this.buffer.writeUInt16BE(state.magneticField, 36, true);
    }

    if (modelChanged || changes.position)
    {
      this.buffer.writeInt16BE(position.x || 0, 38, true);
      this.buffer.writeInt16BE(position.y || 0, 40, true);
      this.buffer.writeInt16BE(position.z || 0, 42, true);
    }

    if (modelChanged || changes.batteryLevel)
    {
      this.buffer.writeUInt16BE(Math.round(state.batteryLevel || 0), 44, true);
    }

    if (modelChanged || changes.batteryVoltage)
    {
      const batteryVoltage = typeof state.batteryVoltage === 'number' ? state.batteryVoltage : 0x00FF;

      this.buffer.writeUInt16BE(Math.round(batteryVoltage * 100), 46, true);
    }

    if (modelChanged || changes.groups)
    {
      this.buffer.writeUInt16BE(state.groups || 0, 48, true);
    }

    if (modelChanged || changes.time)
    {
      const time = state.time ? state.time.getTime() : 0;

      this.buffer.writeUInt32BE(Math.round(time / 1000), 50, true);
    }
  }
}

module.exports = Device;
