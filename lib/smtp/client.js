/* -*- Mode: JavaScript; tab-width: 2; indent-tabs-mode: nil -*- */
/*===============================================
  File: client.js
  Author: Micheil Smith
  
  Description:
    This files implements the raw protocol 
    that is SMTP. The version of SMTP used 
    is as defined in RFC2821.
    
    Implements:
      - SMTP: RFC821
      - ESMTP: RFC2821
      - SMTP Authentication: RFC4954
      - SMTP 8Bit-Mime: RFC1652
      - SMTP over SSL/TLS: RFC2487
    
    Issues:
      - SMTP over SSL/TLS does not work, 
      due to lack of TCP Client SSL/TLS 
      negotiation within node.js
===============================================*/

// Global
var sys = require("sys");
var net = require("net");

// Local
var SMTPError = require("./errors").client;
var PacketHandler = require("./packetHandler").PacketHandler;
var Promise = require('../vendor/Promise');


/*-----------------------------------------------
    SMTP Client
-----------------------------------------------*/
var Client = function(){
  var client = this;
  
  this.socket = null;
  this.packetHandler = new PacketHandler();
  
  this.esmtp = false;
  this.capabilities = {};
  
  this.debug = true;
  
  this.packetHandler.addListener("packet", function(packet){
    if(client.debug){
      sys.puts("\033[0;35m>> "+packet.status+" "+packet.data.join(" ")+"\033[0m");
    }
  })
};

sys.inherits(Client, process.EventEmitter);

Client.prototype.connect = function(port, host){
  var client = this;
  var promise = new Promise.Promise();

  this.port = port;
  this.host = host;
  
  this.socket = new net.createConnection(this.port, this.host);
  this.socket.addListener('error', function(e){
    promise.emitError(e);
  });
  this.socket.setEncoding("ascii");
  
  this.packetHandler.addListener("packet", function(packet){
    client.packetHandler.removeListener("packet", arguments.callee);    
    if(packet.status == "220"){
      if(/ESMTP/i.test(packet.data)){
        client.esmtp = true;
      }
      client.handshake().addCallback(function(){
        promise.emitSuccess(packet);
      });
    } else {
      promise.emitError(packet);
    }
  });

  this.socket.addListener("data", function(data){
    if(client.debug){
      sys.puts("\033[0;33m>> "+data.replace(/[\r\n]/gi, "")+"\033[0m")
    }
    client.packetHandler.receive(data);
  });
  
  return promise;
};

Client.prototype.writeline = function(line){
  if(this.debug){
    sys.puts("\033[0;32m>> "+line+"\033[0m");
  }
  this.socket.write(line+"\r\n");
};

// Legacy Support:
Client.prototype.get = function(data, callback){
  var client = this;
  
  this.waiting = true;
  
  this.packetHandler.addListener("packet", function(){
    client.packetHandler.removeListener("packet", arguments.callee);
    callback.apply(this, arguments);
    client.waiting = false;
  });
  this.writeline(data);
};


// New Evented Send:
Client.prototype.send = function(){
  var client = this;
  var promise = new Promise.Promise();

  this.waiting = true;
  this.packetHandler.addListener("packet", function(){    
    client.packetHandler.removeListener("packet", arguments.callee);
    
    promise.emitSuccess.apply(promise, arguments);
    client.waiting = false;
  });
  
  this.writeline(Array.prototype.join.call(arguments, " "));
  
  return promise;
}

/*-----------------------------------------------
    Handshaking
-----------------------------------------------*/
Client.prototype.handshake = function(){
  if(this.esmtp){
    return this.ehlo();
  } else {
    return this.helo();
  }
};

Client.prototype.parseCapabilities = function(data){
  for(var i=1, j=data.length, item; i<j; ++i){
    item = data[i].split(" ");
    this.capabilities[item[0]] = item.length > 1 ? item.join(" ") : true;
  }
};

Client.prototype.helo = function(){
  var client = this;
  var promise = new Promise.Promise();

  this.send("HELO", this.host).addCallback(function(packet){
    if(packet.status == "250"){
      client.parseCapabilities(packet.data);
      client.connected = true;
      
      promise.emitSuccess(packet);
    } else {
      promise.emitError(packet);
    }
  });
  
  return promise;
};

Client.prototype.ehlo = function(){
  var client = this;
  var promise = new Promise.Promise();

  this.send("EHLO", this.host).addCallback(function(packet){
    if(packet.status == "250"){
      client.parseCapabilities(packet.data);
      client.connected = true;
      
      promise.emitSuccess(packet);
    } else {
      promise.emitError(packet);
    }
  });
  
  return promise;
};

/*-----------------------------------------------
    Authentication
-----------------------------------------------*/
Client.prototype.auth = function(){};

Client.prototype.auth_methods = {
  plain: function(){},
  login: function(){},
  cram_md5: function(){}
};

/*-----------------------------------------------
    Sending mail
-----------------------------------------------*/
Client.prototype.mail = function(address){
  var client  = this;
  var promise = new Promise.Promise();

  address = "<"+address+">";
    
  this.send("MAIL", "FROM:", address).addCallback(function(packet){
    if(packet.status == "250"){
      promise.emitSuccess(packet);
    } else {
      promise.emitError(packet);
    }
  });
  
  return promise;
};

Client.prototype.rcpt = function(address){
  var client  = this;
  var promise = new Promise.Promise();

  address = "<"+address+">";
  
  this.send("RCPT","TO:", address).addCallback(function(packet){
    if(packet.status == "250"){
      promise.emitSuccess(packet);
    } else {
      promise.emitError(packet);
    }
  });

  return promise;
};

Client.prototype.beginData = function(){
  var client = this;
  var promise = new Promise.Promise();

  this.send("DATA").addCallback(function(packet){
    if(packet.status == "354"){
      promise.emitSuccess();
    }else{
      promise.emitError(packet);
    }
  });
  return promise;
};

Client.prototype.sendData = function(data){
  var client = this;
  var promise = new Promise.Promise();

  if(this.debug){
    sys.puts("\033[0;32m>> "+data+"\033[0m");
  }

  var full = !client.socket.write(data);
  if (full){
    client.socket.addListener('drain', function(){
      client.socket.removeListener('drain', arguments.callee);
      promise.emitSuccess();
    });
  }else{
    process.nextTick(function(){
      promise.emitSuccess();
    });
  }
  return promise;
};

Client.prototype.endData = function(){
  var client = this;
  var promise = new Promise.Promise();

  client.send("\r\n.").addCallback(function(packet){
    if(packet.status == "250"){
      promise.emitSuccess();
    } else {
      promise.emitError(packet);
    }
  });

  return promise;
};

Client.prototype.data = function(data){
    var client = this;
    var promise = new Promise.Promise();
    this.beginData()
      .addCallback(function(){
        client.sendData(data)
          .addCallback(function(){
            client.endData()
              .addCallback(function(packet){
                  promise.emitSuccess();
              }).addErrback(function(packet){ promise.emitError(packet); });
          });
      }).addErrback(function(e){ promise.emitError(e); })
;
    return promise;
};

/*-----------------------------------------------
    Other Commands
-----------------------------------------------*/
Client.prototype.rset = function(){};
Client.prototype.vrfy = function(){};
Client.prototype.expn = function(){};
Client.prototype.help = function(){};
Client.prototype.noop = function(){};

/*-----------------------------------------------
    Quit Command
-----------------------------------------------*/
Client.prototype.quit = function(){
  var client = this;
  var promise = new Promise.Promise();
  this.send("QUIT").addCallback(function(packet){
    if(packet.status == "221"){
      client.socket.end();
      promise.emitSuccess();
    } else {
      promise.emitError();
    }
  });
  
  return promise;
};





exports.Client = Client;
