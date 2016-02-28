// Part of <http://miracle.systems/p/h5.modbus.inode> licensed under <MIT>

'use strict';

/**
 * @param {string} macAddress
 * @returns {string}
 * @throws {Error} If the specified `macAddress` is invalid, i.e. it is not a string of six groups of two hexadecimal
 * digits optionally separated by colons (`:`) or hyphens (`-`).
 */
exports.prepareMacAddress = function(macAddress)
{
  const matches = macAddress.toUpperCase().match(/([A-F0-9]{1,2})(?:-|:)?/g);

  if (!matches || matches.length !== 6)
  {
    throw new Error(`Invalid MAC address: ${macAddress}`);
  }

  return matches
    .map(m =>
    {
      m = m.replace(/[^A-F0-9]/g, '');

      return (m.length === 1 ? '0' : '') + m;
    })
    .join(':');
};
