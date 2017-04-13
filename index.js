/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

"use strict";
var http = require('http');
var urlLib = require("url");
var ip = require('ip');
var util = require("util");
var EventEmitter = require("events").EventEmitter;

var soapMessageEnvelopeBegin = generateSOAPMessageEnvelopeBegin();
var soapMessageEnvelopeEnd = '</s:Body></s:Envelope>';

var EVENT_TIMEOUT = 1801;

module.exports = UPnPControlPoint;
util.inherits(UPnPControlPoint, EventEmitter);

function UPnPControlPoint(deviceDescriptionUrl) {
  this.deviceDescriptionUrl = deviceDescriptionUrl;
  this.deviceURL = generateDeviceURL(deviceDescriptionUrl);
  this.deviceDescriptionParsed = null;
  this.serviceDescriptionsParsed = {};
  this.eventListenServer = null;
  this.eventSubscriptions = {};
  EventEmitter.call(this);
  this.eventListenServerListening = false;
}

UPnPControlPoint.prototype.getDeviceDescriptionParsed = function(callback, forceReload) {
  var me = this;
  if(!me.deviceDescriptionParsed || forceReload) {
    me.getDeviceDescriptionRaw(function(err, data) {
      if(err) {
        callback(err);
        return;
      }
      var parseXML = require('xml2js').parseString;
      parseXML(data, {explicitArray: false}, function(err, parsedData) {
        if(err) {
          callback(err);
          return;
        }
        me.deviceDescriptionParsed = {description: parsedData};
        if(!(   me.deviceDescriptionParsed['description']['root']
             && me.deviceDescriptionParsed['description']['root']['device']
             && me.deviceDescriptionParsed['description']['root']['device']['serviceList']
             && me.deviceDescriptionParsed['description']['root']['device']['serviceList']['service'])) {
          var err = new Error('Device description malformed');
          callback(err);
          return;
        }
        var services = me.deviceDescriptionParsed['description']['root']['device']['serviceList']['service'];
        me.deviceDescriptionParsed.services = {};
        if(!Array.isArray(services)) {
          services = [services];
        }
        for(var i = 0; i < services.length; i++) {
          var service = services[i];
          var serviceType = service['serviceType'];
          var controlURL = service['controlURL'];
          var eventSubURL = service['eventSubURL'];
          var serviceDescriptionUrl = service['SCPDURL'];
          if(!serviceType || !controlURL || !eventSubURL || !serviceDescriptionUrl) {
            var err = new Error('Device description malformed');
            callback(err);
            return;
          }
          me.deviceDescriptionParsed.services[serviceType] = {'controlURL': controlURL,
                                                              'eventURL': eventSubURL,
                                                              'serviceDescriptionUrl': serviceDescriptionUrl};
        }
        callback(null, me.deviceDescriptionParsed);
      });
    });
  } else {
    callback(null, me.deviceDescriptionParsed);
  }
}

UPnPControlPoint.prototype.getServiceDescriptionParsed = function(serviceType, callback, forceReload) {
  var me = this;
  if(me.serviceDescriptionsParsed[serviceType] && !forceReload) {
    callback(null, me.serviceDescriptionsParsed[serviceType]);
  } else {
    me.getDeviceDescriptionParsed(function(err, deviceDescriptionParsed) {
      if(err) {
        callback(err);
        return;
      }
      var services = deviceDescriptionParsed['services'];
      var service = services[serviceType];
      if(!service) {
        var err = new Error('Service ' + serviceType + ' not available');
        err.code = 'ENOSERVICE';
        callback(err);
        return;
      }
      var serviceDescriptionUrl = service['serviceDescriptionUrl'];
      var controlURL = service['controlURL'];
      var eventURL = service['eventURL'];
      if(!serviceDescriptionUrl || !controlURL || !eventURL) {
        var err = new Error('Service ' + serviceType + ' malformed');
        callback(err);
        return;
      }
      me.getServiceDescriptionRaw(serviceDescriptionUrl, function(err, data) {
        if(err) {
          callback(err);
          return;
        }
        var parseXML = require('xml2js').parseString;
        parseXML(data, {explicitArray: false}, function(err, parsedData) {
          if(err) {
            callback(err);
            return;
          }
          me.serviceDescriptionsParsed[serviceType] = {'description': parsedData,
                                                       'controlURL': controlURL,
                                                       'eventURL': eventURL,
                                                       'serviceDescriptionUrl': serviceDescriptionUrl};
          var serviceDescriptionParsed = me.serviceDescriptionsParsed[serviceType];
          if(serviceDescriptionParsed['description']
               && serviceDescriptionParsed['description']['scpd']
               && serviceDescriptionParsed['description']['scpd']['actionList']
               && serviceDescriptionParsed['description']['scpd']['actionList']['action']) {
            serviceDescriptionParsed.actions = {};
            var actions = serviceDescriptionParsed['description']['scpd']['actionList']['action'];
            serviceDescriptionParsed.actions = {};
            if(!Array.isArray(actions)) {
              actions = [actions];
            }
            for(var i = 0; i < actions.length; i++) {
              var action = actions[i];
              serviceDescriptionParsed.actions[action['name']] = {};
              if(action['argumentList']) {
                serviceDescriptionParsed.actions[action['name']] = action['argumentList'];
              }
            }
          }
          callback(null, me.serviceDescriptionsParsed[serviceType]);
        });
      });
    }, forceReload);
  }
}

UPnPControlPoint.prototype.invokeActionParsed = function(actionName, args, serviceType, callback, forceReload) {
  var me = this;
  this.getServiceDescriptionParsed(serviceType, function(err, serviceDescription) {
    if(err) {
      callback(err);
      return;
    }
    if(!serviceDescription['actions'] || !serviceDescription['actions'][actionName]) {
      var err = new Error('Action ' + actionName + ' not implemented in service ' + serviceType);
      callback(err);
      return;
    }
    me.invokeActionRaw(actionName, args, serviceType, serviceDescription['controlURL'], function(err, res) {
      var parseXML = require('xml2js').parseString;
      //var stripPrefix = require('xml2js').processors.stripPrefix;
      parseXML(res, {explicitArray: false}, function(err, parsedData) {
        if(err) {
          callback(err);
          return;
        }
        extractActionResponse(parsedData, actionName, serviceType, function(err, extractedData) {
          if(err) {
            callback(err, res);
          } else {
            var returnedData = extractedData;
            returnedData.raw = res;
            callback(null, returnedData);
          }
        });
      });
    });
  }, forceReload);
}

function extractActionResponse(parsedData, actionName, serviceType, callback) {
  var keys = Object.keys(parsedData);
  var error = new Error('I do not understand the action response');
  if(keys.length != 1) {
    callback(error);
    return;
  }
  if(keys[0].indexOf('Envelope') < 0) {
    callback(error);
    return;
  }
  parsedData = parsedData[keys[0]];
  keys = Object.keys(parsedData);
  if(keys.length != 2) {
    callback(error);
    return;
  }
  var index;
  if(keys[0] === '$') {
    index = 1;
  } else {
    index = 0;
  }
  if(keys[index].indexOf('Body') < 0) {
    callback(error);
    return;
  }
  parsedData = parsedData[keys[index]];
  keys = Object.keys(parsedData);
  if(keys.length != 1) {
    callback(error);
    return;
  }
  var splittedKeys = keys[0].split(':');
  if(splittedKeys.length != 2) {
    callback(error);
    return;
  }
  var key = splittedKeys[1];
  if(key.indexOf(actionName + 'Response') >= 0) {
    parsedData = parsedData[keys[0]];
    var d = {};
    d[key] = parsedData;
    callback(null, d);
  } else if(key.indexOf('Fault') >= 0) {
    error = new Error('UPnP Fault');
    callback(error);
  } else {
    callback(error);
  }
}

UPnPControlPoint.prototype.getDeviceDescriptionRaw = function(callback) {
  var req = http.get(this.deviceDescriptionUrl, function(res) {
    res.setEncoding('utf8');
    var data = '';
    res.on('data', function(chunk) {
       data += chunk;
    });
    res.on('end', function() {
      callback(null, data);
    });
    res.on('error', function(err) {
      callback(err);
    });
  });
  req.on('error', function(err) {
    callback(err);
  });
  req.end();
}

UPnPControlPoint.prototype.getServiceDescriptionRaw = function(serviceDescriptionUrl, callback) {
  var req = http.get(this.deviceURL + serviceDescriptionUrl, function(res) {
    res.setEncoding('utf8');
    var data = '';
    res.on('data', function(chunk) {
       data += chunk;
    });
    res.on('end', function() {
      callback(null, data);
    });
    res.on('error', function(err) {
      callback(err);
    });
  });
  req.on('error', function(err) {
    callback(err)
  });
  req.end();
}

UPnPControlPoint.prototype.invokeActionRaw = function(actionName, args, serviceType, controlURL, callback) {
  var soapMessage = generateSOAPMessage(actionName, args, serviceType);
  var controlURLAbsolute = this.deviceURL + controlURL;
  var opts = urlLib.parse(controlURLAbsolute);
  opts.method = "POST";
  opts.headers = {'Content-Type': 'text/xml; charset="utf-8"',
                  'SOAPACTION': '"' + serviceType + '#' + actionName + '"',
                  'Content-Length': Buffer.byteLength(soapMessage),
                  };
  var req = http.request(opts, function(res) {
    res.setEncoding('utf8');
    var data = '';
    res.on('data', function(chunk) {
       data += chunk;
    });
    res.on('end', function() {
      callback(null, data);
    });
    res.on('error', function(err) {
      callback(err);
    });
  });
  req.on('error', function(err) {
    callback(err);
  });
  req.write(soapMessage);
  req.end();
}


UPnPControlPoint.prototype.subscribe = function(serviceType, callback, forceReload) {
  var me = this;
  this.getServiceDescriptionParsed(serviceType, function(err, serviceDescription) {
    if(err) {
      callback(err);
      return;
    }
    var eventURL = serviceDescription['eventURL'];
    if(me.eventListenServer && me.eventListenServerListening && eventURL) {
      var eventURLAbsolute = me.deviceURL + eventURL;
      var eventAlreadySubscribed = false;
      Object.keys(me.eventSubscriptions).forEach(function(sid) {
          if(me.eventSubscriptions[sid]['eventURL'] === eventURL) {
            eventAlreadySubscribed = true;
          }
      });
      if(eventAlreadySubscribed) {
        callback(null);
        return;
      }
      var opts = urlLib.parse(eventURLAbsolute);
      opts.method = 'SUBSCRIBE';
      opts.headers = {
        'CALLBACK': '<http://' + me.eventListenServer.address().address + ':' + me.eventListenServer.address().port + '/>',
        'NT': 'upnp:event',
        'TIMEOUT': 'Second-' + EVENT_TIMEOUT
      };
      var req = http.request(opts, function(res) {
        if(res.headers.hasOwnProperty('sid') && res.headers.hasOwnProperty('timeout')) {
          var sid = res.headers.sid;
          var parsedEventTimeout = parseInt(res.headers['timeout'].substr(7))*1000-10000;
          me.eventSubscriptions[sid] = {'eventURL': eventURL
                                        ,'serviceType': serviceType};
          me.eventSubscriptions[sid]['timer'] = setTimeout(function() {
            me.renewEventSubscription(eventURL, sid);
          }, parsedEventTimeout);
          me.emit('subscribed', {'sid': sid, 'serviceType': serviceType});
          callback(null);
        } else {
          var err = new Error('Header malformed');
          callback(err);
        }
      });
      req.on('error', function(err) {
        callback(err);
      });
      req.end();
    } else {
      var err = new Error('No event listen server listening');
      callback(err);
    }
  }, forceReload);
}

UPnPControlPoint.prototype.unsubscribe = function(serviceType, callback) {
  var me = this;
  this.getServiceDescriptionParsed(serviceType, function(err, serviceDescription) {
    if(err) {
      callback(err);
      return;
    }
    var eventURL = serviceDescription['eventURL'];
    if(eventURL) {
      var eventURLAbsolute = me.deviceURL + eventURL;
      var eventSubscribed = false;
      var eventSid;
      Object.keys(me.eventSubscriptions).forEach(function(sid) {
          if(me.eventSubscriptions[sid]['eventURL'] === eventURL) {
            eventSid = sid;
            eventSubscribed = true;
          }
      });
      if(eventSubscribed) {
        var opts = urlLib.parse(eventURLAbsolute);
        opts.method = 'UNSUBSCRIBE';
        opts.headers = {
          'SID': eventSid
        };
        var req = http.request(opts, function(res) {
          if(res.statusCode !== 200) {
            var err = new Error('unsubscribe error');
            callback(err);
          } else {
            me.emit('unsubscribed', {'sid': eventSid, 'serviceType': serviceType});
            clearTimeout(me.eventSubscriptions[eventSid]['timer']);
            delete me.eventSubscriptions[eventSid];
            callback(null);
          }
        });
        req.on('error', function(err) {
          callback(err);
        });
        req.end();
      } else {
        callback(null);
      }
    } else {
      var err = new Error('Unsubscribe error: eventURL not available');
      callback(err);
    }
  });
}

UPnPControlPoint.prototype.createEventListenServer = function(callback) {
  var me = this;
  if(!this.eventListenServer) {
    this.eventListenServer = http.createServer(function(req, res) {
      req.setEncoding('utf8');
      var data = '';
      req.on('data', function(chunk) {
         data += chunk;
      });
      req.on('end', function() {
        var sid = req.headers['sid'];
        var seq = req.headers['seq'];
        if(!sid || !seq) {
          var err = new Error('Header malformed');
          me.emit('error', err);
        } else {
          if(me.eventSubscriptions.hasOwnProperty(sid)) {
            var serviceType = me.eventSubscriptions[sid]['serviceType'];
            parseAndExtractEvent(data, function(error, extractedData) {
              if(error) {
                me.emit('error', error);
              } else {
                var eventMessage = {};
                eventMessage['events'] = extractedData;
                eventMessage['raw'] = data;
                eventMessage['seq'] = seq;
                eventMessage['serviceType'] = serviceType;
                me.emit('upnpEvent', eventMessage);
              }
            });
          }
        }
      });
      req.on('error', function(err) {
        me.emit('error', err);
      });
      res.writeHead(200);
      res.end();
      res.on('error', function(err) {
        me.emit('error', err);
      });
    });
    this.eventListenServer.listen(0, ip.address());
    this.eventListenServer.on('listening', function() {
      me.emit('eventListenServerListening', true);
      me.eventListenServerListening = true;
      if(callback) {
        callback();
      }
    });
    this.eventListenServer.on('close', function() {
      me.emit('eventListenServerListening', false);
      me.eventListenServerListening = false;
    });
  }
}

function parseAndExtractEvent(raw, callback) {
  var parseXML = require('xml2js').parseString;
  parseXML(raw, {explicitArray: false}, function(err, parsedData) {
    if(err) {
      callback(err);
      return;
    }
    var keys = Object.keys(parsedData);
    var error = new Error('I do not understand the event');
    if(keys.length != 1) {
      callback(error);
      return;
    }
    if(keys[0].indexOf('propertyset') < 0) {
      callback(error);
      return;
    }
    parsedData = parsedData[keys[0]];
    keys = Object.keys(parsedData);
    if(keys.length != 2) {
      callback(error);
      return;
    }
    var index;
    if(keys[0] === '$') {
      index = 1;
    } else {
      index = 0;
    }
    if(keys[index].indexOf('property') < 0) {
      callback(error);
      return;
    }
    parsedData = parsedData[keys[index]];
    callback(null, parsedData);
  });
}

UPnPControlPoint.prototype.closeEventListenServer = function(callback) {
  var me = this;
  me.eventListenServer.close(function() {
    me.eventListenServer = null;
    callback();
  });
}

UPnPControlPoint.prototype.renewEventSubscription = function renewEventSubscription(eventURL, sid) {
  var me = this;
  var eventURLAbsolute = this.deviceURL + eventURL;
  var opts = urlLib.parse(eventURLAbsolute);
  opts.method = 'SUBSCRIBE';
  opts.headers = {
    'SID': sid,
    'TIMEOUT': 'Second-' + EVENT_TIMEOUT
  };
  var req = http.request(opts, function(res) {
    if(res.headers.hasOwnProperty('sid') && res.headers.hasOwnProperty('timeout')) {
      var sid = res.headers.sid;
      var parsedEventTimeout = parseInt(res.headers['timeout'].substr(7))*1000-10000;
      me.eventSubscriptions[sid]['timer'] = setTimeout(function() {
        me.renewEventSubscription(eventURL, sid);
      }, parsedEventTimeout);
      me.emit('subscribed', {'sid': sid, 'serviceType': me.eventSubscriptions[sid]['serviceType']});
    } else {
      var err = new Error('Header malformed');
      me.emit('error', err);
    }
    res.on('error', function(err) {
      me.emit('error', err);
    })
  });
  req.on('error', function(err) {
    me.emit('error', err);
  });
  req.end();
}

function generateDeviceURL(serviceDescriptionUrl) {
  var parsedURL = urlLib.parse(serviceDescriptionUrl);
  return 'http://' + parsedURL.host;
}

function generateSOAPMessage(actionName, args, serviceType) {
  var message = soapMessageEnvelopeBegin;
  message += '<u:' + actionName + ' xmlns:u="' + serviceType + '">';
  Object.keys(args).forEach(function(argumentName) {
    var argumentValue = args[argumentName];
    message += '<' + argumentName + '>';
    message += argumentValue;
    message += '</' + argumentName + '>';
  });
  message += '</u:' + actionName + '>';
  message += soapMessageEnvelopeEnd;
  return message;
}

function generateSOAPMessageEnvelopeBegin() {
  var message  = '<?xml version="1.0" encoding="utf-8"?>';
  message     += '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">';
  message     += '<s:Body>';
  return message;
}
