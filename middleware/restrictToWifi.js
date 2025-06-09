const ip = require('ip');

const CAFE_WIFI_SUBNET = process.env.CAFE_WIFI_SUBNET || '192.168.0.0/24';

function restrictToWifi(req, res, next) {
  try {
    const xForwardedFor = req.headers['x-forwarded-for'];
    const clientIp = xForwardedFor?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    
    // Log detailed IP info
    console.log(`Client IP: ${clientIp}, x-forwarded-for: ${xForwardedFor}, Request Path: ${req.path}, Subnet: ${CAFE_WIFI_SUBNET}`);
    
    // Temporarily allow all private IPs for debugging
    if (clientIp === 'unknown') {
      console.log(`Unknown IP, rejecting`);
      return res.status(403).json({ error: 'Unable to detect IP. Please connect to café Wi-Fi.' });
    }

    // Check if IP is in subnet
    if (!ip.cidrSubnet(CAFE_WIFI_SUBNET).contains(clientIp)) {
      console.log(`IP ${clientIp} is not in subnet ${CAFE_WIFI_SUBNET}, rejecting`);
      return res.status(403).json({ error: `IP ${clientIp} not in café Wi-Fi subnet. Please connect to café Wi-Fi.` });
    }

    console.log(`IP ${clientIp} is in subnet ${CAFE_WIFI_SUBNET}, allowing`);
    next();
  } catch (err) {
    console.error('IP check error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = restrictToWifi;