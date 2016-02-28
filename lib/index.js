// Part of <http://miracle.systems/p/h5.modbus.inode> licensed under <MIT>

'use strict';

const hci = require('h5.bluetooth.hci');
const iNodeHci = require('h5.bluetooth.hci.inode');

iNodeHci.registerManufacturerSpecificDataDecoder(hci.decoders.eirDataType);

exports.Device = require('./Device');

exports.Gateway = require('./Gateway');
