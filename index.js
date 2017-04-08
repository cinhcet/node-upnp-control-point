"use strict";
var http = require('http');
var urlLib = require("url");

var soapMessageEnvelopeBegin = generateSOAPMessageEnvelopeBegin();
var soapMessageEnvelopeEnd = '</s:Body></s:Envelope>';

module.exports = UPnPClient;

function UPnPClient(serviceDescriptionUrl) {
  this.deviceURL = generateDeviceURL(serviceDescriptionUrl);
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
    res.on('data',function(chunk) {
       data += chunk;
    });
    res.on('end', function() {
      callback(null, data);
    });
  });
  req.on('error', function(err) {
    callback(err)
  });
  req.write(soapMessage);
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
