// Part of <http://miracle.systems/p/h5.modbus.inode> licensed under <MIT>

'use strict';

const buffers = require('h5.buffers');
const modbus = require('h5.modbus');
const btHci = require('h5.bluetooth.hci');

class Gateway
{
  /**
   * @param {GatewayOptions} options
   */
  constructor(options)
  {
    /**
     * @type {function(this:Gateway, number, Request, respondCallback)}
     */
    this.handleModbusRequest = this.handleModbusRequest.bind(this);

    if (!options)
    {
      options = {};
    }

    /**
     * @private
     * @type {boolean}
     */
    this.hexEncoded = options.hexEncoded !== false;

    /**
     * @private
     * @type {number}
     */
    this.deviceTimeout = options.deviceTimeout || 20000;

    /**
     * @private
     * @type {Set<Connection, ConnectionState>}
     */
    this.connections = new Map();

    /**
     * @private
     * @type {Set<Device>}
     */
    this.devices = new Set();

    /**
     * @private
     * @type {Map<number, Device>}
     */
    this.unitToDevice = new Map();

    /**
     * @private
     * @type {Map<string, Device>}
     */
    this.macToDevice = new Map();
  }

  destroy(recursive)
  {
    this.connections.forEach((s, c) =>
    {
      this.removeConnection(c);

      if (recursive)
      {
        c.destroy();
      }
    });

    this.devices.forEach(d => this.removeDevice(d));
  }

  /**
   * @param {Device} device
   * @throws {Error} If a different device with the same unit was already registered.
   * @throws {Error} If a different device with the same MAC address was already registered.
   */
  addDevice(device)
  {
    if (this.devices.has(device))
    {
      return;
    }

    if (this.unitToDevice.has(device.unit))
    {
      throw new Error(`Device with unit [${device.unit}] was already registered!`);
    }

    if (this.macToDevice.has(device.mac))
    {
      throw new Error(`Device with MAC address [${device.mac}] was already registered!`);
    }

    this.unitToDevice.set(device.unit, device);
    this.macToDevice.set(device.mac, device);
  }

  /**
   * @param {Device} device
   */
  removeDevice(device)
  {
    if (!this.devices.has(device))
    {
      return;
    }

    this.unitToDevice.delete(device.unit);
    this.macToDevice.delete(device.mac);
    this.devices.delete(device);
  }

  /**
   * @param {Connection} connection
   */
  addConnection(connection)
  {
    if (this.connections.has(connection))
    {
      return;
    }

    const state = {
      buffer: new buffers.BufferQueueReader(),
      onData: this.onConnectionData.bind(this, connection),
      destroy: () =>
      {
        state.buffer.skip(state.buffer.length);
        state.buffer = null;

        connection.removeListener('data', state.onData);
        state.onData = null;
      }
    };

    connection.on('data', state.onData);

    this.connections.set(connection, state);
  }

  /**
   * @param {Connection} connection
   */
  removeConnection(connection)
  {
    const state = this.connections.get(connection);

    if (!state)
    {
      return;
    }

    state.destroy();

    this.connections.delete(connection);
  }

  /**
   * @param {number} unit
   * @param {Request} request
   * @param {respondCallback} respond
   */
  handleModbusRequest(unit, request, respond)
  {
    const device = this.unitToDevice.get(unit);

    if (!device)
    {
      respond(modbus.ExceptionCode.IllegalDataAddress);

      return;
    }

    if (!device.isAvailable(this.deviceTimeout))
    {
      respond(modbus.ExceptionCode.GatewayTargetDeviceFailedToRespond);

      return;
    }

    device.handleModbusRequest(request, respond);
  }

  /**
   * @private
   * @param {Connection} connection
   * @param {Buffer} data
   */
  onConnectionData(connection, data)
  {
    const state = this.connections.get(connection);

    if (!state)
    {
      return;
    }

    if (this.hexEncoded)
    {
      data = new Buffer(data.toString(), 'hex');
    }

    state.buffer.push(data);

    this.decodeHciPacket(state.buffer);
  }

  /**
   * @private
   * @param {BufferQueueReader} bufferReader
   */
  decodeHciPacket(bufferReader)
  {
    // TODO: change to readBuffer() and skip() when the h5.bluetooth.hci has all the required decoders
    const buffer = bufferReader.shiftBuffer(bufferReader.length);
    const hciPacket = btHci.decode(buffer);

    if (hciPacket.type === btHci.PacketType.Event
      && hciPacket.eventCode === btHci.EventCode.LeMeta
      && hciPacket.parameters.leSubeventCode === btHci.LeSubeventCode.AdvertisingReport)
    {
      this.handleHciAdvertisingReportEvent(hciPacket);
    }
  }

  /**
   * @private
   * @param {HciAdvertisingReportEvent} hciPacket
   */
  handleHciAdvertisingReportEvent(hciPacket)
  {
    hciPacket.parameters.reports.forEach(r => this.handleAdvertisingReport(r));
  }

  /**
   * @private
   * @param {AdvertisingReport} report
   */
  handleAdvertisingReport(report)
  {
    const device = this.macToDevice.get(report.address);

    if (device)
    {
      device.handleAdvertisingReport(report);
    }
  }
}

module.exports = Gateway;

/**
 * @typedef {Object} GatewayOptions
 * @property {boolean} [hexEncoded=true]
 * @property {number} [deviceTimeout=20000]
 */
