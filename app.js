/**
 * cPanel Phusion Passenger & Node.js Selector Giriş Noktası (Entrypoint)
 * 
 * cPanel varsayılan olarak "Application startup file" olarak "app.js" arar.
 * Bu dosya ana Express sunucusu olan server.js'i yükleyip dışa aktarır.
 */

module.exports = require('./server.js');
