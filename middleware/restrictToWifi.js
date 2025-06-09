const ip = require('ip');

const CAFE_WIFI_SUBNET = process.env.CAFE_WIFI_SUBNET || '192.168.1.0/24';

function restrictToWifi(req, res, next) {
  try {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    
    // Log IP for debugging
    console.log(`Client IP: ${clientIp}, Request Path: ${req.path}`);
    
    if (!ip.isPrivate(clientIp)) {
      console.log(`IP ${clientIp} is not private, rejecting`);
      return res.status(403).json({ error: 'Please connect to café Wi-Fi to access this resource.' });
    }

    if (!ip.cidrSubnet(CAFE_WIFI_SUBNET).contains(clientIp)) {
      console.log(`IP ${clientIp} is not in subnet ${CAFE_WIFI_SUBNET}, rejecting`);
      return res.status(403).json({ error: 'Please connect to café Wi-Fi to access this resource.' });
    }

    console.log(`IP ${clientIp} is in subnet ${CAFE_WIFI_SUBNET}, allowing`);
    next();
  } catch (err) {
    console.error('IP check error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = restrictToWifi;