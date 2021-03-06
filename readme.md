﻿# h5.modbus.inode

MODBUS <-> iNode.pl devices gateway.

## Requirements

  * [Node.js](https://nodejs.org/) >= v4
  * [iNode.pl](https://inode.pl/index/s_lang/en) Bluetooth Low Energy devices

## Usage

MODBUS slave:

```js
'use strict';

const modbus = require('h5.modbus');
const iNodeModbus = require('h5.modbus.inode');

const gateway = new iNodeModbus.Gateway({
  // Whether the data emitted by connections is hex encoded
  hexEncoded: true,
  // A function to call after receiving an Advertising Report from an unknown device
  unknownDeviceHandler: function handleUnknownDevice(report)
  {
    console.log('Report from an unknown device:', report);
  }
});

const slave = modbus.createSlave({
  requestHandler: gateway.handleModbusRequest
});

// Add connections to all iNode LANs in the network
gateway.addConnection(modbus.createConnection({
  socketOptions: {
    // iNode LAN IP address
    host: '192.168.1.210',
    // iNode LAN TCP socket port
    port: 5500
  },
  // Time since the last data buffer was received after which the connection is closed and reopened.
  // Helps to automatically re-establish the connection if someone opened the iNode LAN monitor app.
  noActivityTime: 10000
}));

const options = {
  // Time since the last advertising report was received after which a device should be considered unavailable.
  // Unavailable devices will return the MODBUS exception code 0x0B (Gateway Target Device Failed To Respond).
  deviceTimeout: 20000
};

// Map iNode device MAC addresses to MODBUS units
gateway.addDevice(new iNodeModbus.Device('00:12:6F:6D:3E:06', 1, options));
gateway.addDevice(new iNodeModbus.Device('00:12:6F:6D:3C:55', 2, options));
gateway.addDevice(new iNodeModbus.Device('00:12:6F:91:35:FB', 100, options));
gateway.addDevice(new iNodeModbus.Device('00:12:6F:91:37:A1', 101, options));
```

MODBUS master:

```js
'use strict';

const modbus = require('h5.modbus');

const master = modbus.createMaster();

master.once('open', () =>
{
  const t = master.readHoldingRegisters(16, 3, {
    unit: 1,
    interval: 1000
  });

  t.on('response', (res) =>
  {
    if (res.isException())
    {
      console.log(`${res}`);

      return;
    }

    const flags = res.data.readUInt16BE(0);
    const input = flags & 1 ? 1 : 0;
    const output = flags & 2 ? 1 : 0;
    const motion = flags & 4 ? 1 : 0;
    const temperature = res.data.readInt16BE(2) / 100;
    const humidity = res.data.readUInt16BE(4) / 100;

    console.log(`in=${input} out=${output} motion=${motion} T=${temperature} H=${humidity}`);
  });
});
```

## MODBUS

The MODBUS slave supports only one function code - 0x03 (Read Holding Registers).

All device models have the same first 16 registers:

  * 0-2 - MAC address
  * 3-10 - local name (string)
  * 11 - model (uint16be)
  * 12 - RSSI (int16be; `0xFF` if undefined)
  * 13 - TX power level (int16be; `0xFF` if undefined)
  * 14 - RTTO (uint16be)
  * 15 - alarm bits:
    * 0 - LOW_BATTERY
    * 1 - MOVE_ACCELEROMETER,
    * 2 - LEVEL_ACCELEROMETER,
    * 3 - LEVEL_TEMPERATURE,
    * 4 - LEVEL_HUMIDITY,
    * 5 - CONTACT_CHANGE,
    * 6 - MOVE_STOPPED,
    * 7 - MOVE_GTIMER,
    * 8 - LEVEL_ACCELEROMETER_CHANGE,
    * 9 - LEVEL_MAGNET_CHANGE,
    * 10 - LEVEL_MAGNET_TIMER

The next registers depend on the model of the device.

### Decoding values

For example, the following register:

> 22 - light level (uint16be; `0xFF` if undefined; value is multiplied by a 100)

means that the light level is available under register 22, i.e. bytes 44 and 45
that should be read as an unsigned 16-bit integer (big-endian) and divided by a 100.
If the resulting value is equal to `0xFF` then it's undefined (the device model
doesn't support that value or it wasn't received yet).

```js
const lightLevelRegister = new Buffer([0x63, 0x9C]);
const lightLevel = lightLevelRegister.readUInt16BE(0) / 100;
console.log(lightLevel === 0xFF ? `null` : `${lightLevel}%`); // null
```

```js
const lightLevelRegister = new Buffer([0x27, 0x10]);
const lightLevel = lightLevelRegister.readUInt16BE(0) / 100;
console.log(lightLevel === 0xFF ? `null` : `${lightLevel}%`); // 100%
```

```js
const lightLevelRegister = new Buffer([0x04, 0xD2]);
const lightLevel = lightLevelRegister.readUInt16BE(0) / 100;
console.log(lightLevel === 0xFF ? `null` : `${lightLevel}%`); // 12.34%
```

### Care Relay

  * 16 - flag bits:
    * 0 - none
    * 1 - output

### Energy Meter

  * 16 - constant (uint16be)
  * 17 - unit (uint16be):
    * 0 - kWh/kW
    * 1 - m³
    * 2 - cnt (impulse count)
  * 18-19 - total value (uint32be; value is multiplied by a 100 if the unit is not equal to 2)
  * 20-21 - average value (uint32be; value is multiplied by a 100 if the unit is not equal to 2)
  * 22 - light level (uint16be; `0xFF` if undefined; value is multiplied by a 100)
  * 23 - week day (uint16be; `0xFF` if undefined)
  * 24-25 - week day total value (uint32be; value is multiplied by a 100)
  * 26 - battery level (uint16be)
  * 27 - battery voltage (uint16be; `0xFF` if undefined; value is multiplied by a 100)

### Care Sensor

  * 16 - flag bits:
    * 0 - input or magnetic field direction in case of CS#5
    * 1 - output
    * 2 - motion
  * 17 - temperature (int16be; `0xFF` if undefined; value is multiplied by a 100)
  * 18 - humidity (uint16be; `0xFF` if undefined; value is multiplied by a 100)
         or magnetic field value in case of CS#5 (uint16be; `0xFF` if undefined)
  * 19 - pressure (uint16be; value is multiplied by 16)
  * 20 - position x (int16be)
  * 21 - position y (int16be)
  * 22 - position z (int16be)
  * 23 - battery level (uint16be)
  * 24 - battery voltage (uint16be; `0xFF` if undefined; value is multiplied by a 100)
  * 25 - group bits
  * 26-27 - time (uint32be)

## TODO

  - Tests
  - API Documentation
  - npm publish

## License

This project is released under the [MIT License](https://raw.github.com/morkai/h5.modbus.inode/master/license.md).
