'use strict';

var Service, Characteristic;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory('homebridge-hue-sensor-average', 'HueSensorAvg', Accessory);
};

const axios = require('axios');
const average = arr => arr.reduce((sum, el) => sum + el, 0) / arr.length;

const noResponse = new Error('No Response')
noResponse.toString = () => { return noResponse.message }

function getLux(lightLevel) {
  return 10 ** ((lightLevel - 1) / 10000);
}

var hueBridgeIp = null;

async function getBridgeIp(bridgeId, log) {
    try {
      let bridges = await axios.get('https://discovery.meethue.com/');
      bridges.data.forEach(bridge => {
        if (bridge.id == bridgeId) hueBridgeIp = bridge.internalipaddress;
      });
    }
    catch (e) { log("Error obtaining bridge IP"); }
}

async function getLightLevel(bridgeId, apiKey, sensorId, log) {
  if (!hueBridgeIp) {
    await getBridgeIp(bridgeId, log);
  }
  if (hueBridgeIp) {
    const apiEndpoint = "http://" + hueBridgeIp + "/api/" + apiKey + "/sensors/" + sensorId;
    try {
      let sensorData = await axios.get(apiEndpoint);
      let level = sensorData.data.state.lightlevel;
      if (typeof level == 'number') return getLux(level);
      else log("Invalid sensor light level");
    }
    catch (e) {
      log("Failed to get sensor light level");
      getBridgeIp(bridgeId, log);
    }
  } else { log("Failed to find Hue bridge, please check configuration"); }
  return null;
}

function Accessory(log, config) {
  var platform = this;
  this.log = log;

  this.name = config.name;
  this.service = new Service['LightSensor'](this.name);

  var llChar = this.service.getCharacteristic(Characteristic.CurrentAmbientLightLevel);
  var fltChar = this.service.addCharacteristic(Characteristic.StatusFault);

  var hueBridgeId = config.bridgeId;
  var hueBridgeKey = config.bridgeKey;
  var hueSensorId = config.sensorId;

  if (!hueBridgeId || !hueBridgeKey || !hueSensorId) {
    log("Invalid bridge or sensor definition, please check configuration");
    fltChar.updateValue(Characteristic.StatusFault.GENERAL_FAULT);
    return;
  }

  var timeWindow = config.timeWindow || 900;
  var pollInterval = config.pollInterval || 30;

  const maxElems = Math.floor(timeWindow / pollInterval);

  var readings = [];

  function addReading() {
    getLightLevel(hueBridgeId, hueBridgeKey, hueSensorId, log).then((reading) => {
      if (reading) {
        if (readings.length == maxElems) readings.shift();
        readings.push(reading);
        llChar.updateValue(Math.max(0, Math.min(Math.round(average(readings)), 100000)));
        fltChar.updateValue(Characteristic.StatusFault.NO_FAULT);
      } else { fltChar.updateValue(Characteristic.StatusFault.GENERAL_FAULT); }
    });
  }

  addReading();

  var updateTimer = setInterval(addReading, pollInterval * 1000);
}

Accessory.prototype.getServices = function() {
  return [this.service];
};
