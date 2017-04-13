# node-upnp-control-point
This is a simple UPnP&trade; control point library, which allows you to control an UPnP&trade; device and receive events from it.

## Functionality
The UPnP&trade; architecture consists of
* Discovery: Find UPnP&trade; devices in the network.
* Description: Get the capabilities of a discovered device in terms of the device and service description.
* Control: Invoke actions.
* Eventing: Get notified when a UPnP&trade; device changes it status.

The purpose of this module is to provide easy access to description, control and eventing. Discovery is not part of this module at the moment. Fortunately, [node-ssdp](https://www.npmjs.com/package/node-ssdp) provides this functionality easily!

## Usage
First use [node-ssdp](https://www.npmjs.com/package/node-ssdp) to discovery the device description xml file you would like to control, e.g.
```javascript
var deviceXML = 'http://IP:PORT/description.xml';
```
Then create an instance
```javascript
var UPnPControlPoint = require('node-upnp-control-point');
var deviceXML = 'http://IP:PORT/description.xml';
var cp = new UPnPControlPoint(deviceXML);
```
and retrieve the device description
```javascript
var UPnPControlPoint = require('node-upnp-control-point');
var deviceXML = 'http://IP:PORT/description.xml';
var cp = new UPnPControlPoint(deviceXML);

var util = require("util");

cp.getDeviceDescriptionParsed(function(err, data) {
  console.log(util.inspect(data, false, null));
});
```
Assume you want control a media renderer which implements a AVTransportService of version 1, then
```javascript
var UPnPControlPoint = require('node-upnp-control-point');
var deviceXML = 'http://IP:PORT/description.xml';
var cp = new UPnPControlPoint(deviceXML);

var util = require("util");

cp.getServiceDescriptionParsed('urn:schemas-upnp-org:service:AVTransport:1', function(err, data) {
  console.log(util.inspect(data, false, null));
});
```
will get you the service description.

You have a media server? Then test
```javascript
var UPnPControlPoint = require('node-upnp-control-point');
var deviceXML = 'http://IP:PORT/description.xml';

var util = require("util");

var mediaServerCP = new UPnPControlPoint(deviceXML);
mediaServerCP.invokeActionParsed("Browse", {ObjectID: "1", BrowseFlag: "BrowseDirectChildren", Filter: "*", StartingIndex: 0}, 'urn:schemas-upnp-org:service:ContentDirectory:1', function(err, m) {
  console.log(util.inspect(m, false, null));
});
```
Read the upnp specifications!

You want events?
```javascript
var UPnPControlPoint = require('node-upnp-control-point');
var deviceXML = 'http://IP:PORT/description.xml';
var cp = new UPnPControlPoint(deviceXML);

cp.createEventListenServer(function() {
  cp.subscribe('urn:schemas-upnp-org:service:AVTransport:1', function(err) {
    if(err) {
      console.log(err);
    } else {
      console.log('subscribed');
    }
  });
});


cp.on('upnpEvent', function(data) {
  console.log(data);
});
```
make sure to unsubscribe and close the event listen server afterwards.


## Alpha Release
Note that this is an alpha release, which means that the API might change and there could be bugs. However, it should be useable right now and if you found
any issues or any improvements, please let me know. Feedback is appreciated!


## Acknowledgements
This module was inspired by the module `node-upnp-device-client` from Thibaut Séguy, see [git](https://github.com/thibauts/node-upnp-device-client). The API is similar, but not compatible.
