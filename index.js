"use strict";
var http = require('http');
var urlLib = require("url");
var address = require('network-address');
var util = require("util");
var EventEmitter = require("events").EventEmitter;

var soapMessageEnvelopeBegin = generateSOAPMessageEnvelopeBegin();
var soapMessageEnvelopeEnd = '</s:Body></s:Envelope>';

var EVENT_TIMEOUT = 1801;

module.exports = UPnPClient;
util.inherits(UPnPClient, EventEmitter);

function UPnPClient(deviceDescriptionUrl) {
  this.deviceDescriptionUrl = deviceDescriptionUrl;
  this.deviceURL = generateDeviceURL(deviceDescriptionUrl);
  this.deviceDescriptionParsed = null;
  this.serviceDescriptionsParsed = {};
  this.eventListenServer = null;
  this.eventSubscriptions = {};
  EventEmitter.call(this);
}

UPnPClient.prototype.getDeviceDescriptionParsed = function(callback, forceReload) {
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

UPnPClient.prototype.getServiceDescriptionParsed = function(serviceType, callback, forceReload) {
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

UPnPClient.prototype.invokeActionParsed = function(actionName, args, serviceType, callback, forceReload) {
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
        parsedData.raw = res;
        callback(null, parsedData);
      });
    });
  }, forceReload);
}

UPnPClient.prototype.getDeviceDescriptionRaw = function(callback) {
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

UPnPClient.prototype.getServiceDescriptionRaw = function(serviceDescriptionUrl, callback) {
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

UPnPClient.prototype.invokeActionRaw = function(actionName, args, serviceType, controlURL, callback) {
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


UPnPClient.prototype.subscribe = function(serviceType, callback, forceReload) {
  var me = this;
  this.getServiceDescriptionParsed(serviceType, function(err, serviceDescription) {
    if(err) {
      callback(err);
      return;
    }
    var eventURL = serviceDescription['eventURL'];
    if(me.eventListenServer && eventURL) {
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
          var parsedEventTimeout = parseInt(res.headers['timeout'].substr(7))*1000;
          me.eventSubscriptions[sid] = {'eventURL': eventURL
                                        ,'serviceType': serviceType};
          me.eventSubscriptions[sid]['timer'] = setTimeout(function() {
            me.renewEventSubscription(eventURL, sid);
          }, parsedEventTimeout);
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
    }
  }, forceReload);
}

UPnPClient.prototype.unsubscribe = function(serviceType, callback) {
  var me = this;
  this.getServiceDescriptionParsed(serviceType, function(err, serviceDescription) {
    if(err) {
      callback(err);
      return;
    }
    var eventURL = serviceDescription['eventURL'];
    if(me.eventListenServer && eventURL) {
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
            clearTimeout(me.eventSubscriptions[eventSid]['timer']);
            delete me.eventSubscriptions[eventSid];
            callback(null);
          }
        });
        req.on('error', function(err) {
          callback(err);
        });
        req.end();
      }
    }
  });
}

UPnPClient.prototype.createEventListenServer = function(callback) {
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
            var eventMessage = {'dataRaw': data
                                ,'seq': seq
                                ,'serviceType': serviceType};
            me.emit('upnpEvent', eventMessage);
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
    this.eventListenServer.listen(0, address.ipv4());
    this.eventListenServer.on('listening', function() {
      me.emit('eventListenServerListening', true);
      callback();
    });
  }
}

UPnPClient.prototype.closeEventListenServer = function(callback) {
  var me = this;
  Object.keys(me.eventSubscriptions).forEach(function(sid) {
      clearTimeout(me.eventSubscriptions[sid]['timer']);
      delete me.eventSubscriptions[sid];
  });
  me.eventListenServer.close();
  me.eventListenServer = null;
  me.emit('eventListenServerListening', false);
  callback();
}

UPnPClient.prototype.renewEventSubscription = function renewEventSubscription(eventURL, sid) {
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
      var parsedEventTimeout = parseInt(res.headers['timeout'].substr(7))*1000;
      me.eventSubscriptions[sid]['timer'] = setTimeout(function() {
        me.renewEventSubscription(eventURL, sid);
      }, parsedEventTimeout);
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
