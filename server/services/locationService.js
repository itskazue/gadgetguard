/**
 * NCST GadgetGuard - Location Service
 * Reverse Geocoding (GPS) & IP-Based Geolocation Fallback
 * 
 * Requirements:
 * 1. Priority 1: Browser GPS -> Reverse geocode to landmark, street, barangay, city, province.
 *    Prefix: "Approximate Location: [Landmark], [City], [Province]"
 * 2. Priority 2: Fallback to IP geolocation if GPS denied/unavailable.
 *    Prefix: "Estimated Location: [City], [Province]" (Never invent a landmark).
 * 3. Fallback: "Location unavailable" if both fail.
 * 4. Save: placeName, city, province, latitude, longitude, locationSource, scan date/time.
 */

// Common Calabarzon / Cavite City -> Province mapping for clean IP fallback display
const CITY_PROVINCE_MAP = {
  'dasmarinas': 'Cavite',
  'dasmariñas': 'Cavite',
  'bacoor': 'Cavite',
  'imus': 'Cavite',
  'general trias': 'Cavite',
  'gen. trias': 'Cavite',
  'trece martires': 'Cavite',
  'silang': 'Cavite',
  'tagaytay': 'Cavite',
  'kawit': 'Cavite',
  'carmona': 'Cavite',
  'rosario': 'Cavite',
  'tanza': 'Cavite',
  'naic': 'Cavite',
  'maragondon': 'Cavite',
  'alfonso': 'Cavite',
  'amadeo': 'Cavite',
  'calamba': 'Laguna',
  'santa rosa': 'Laguna',
  'sta. rosa': 'Laguna',
  'biñan': 'Laguna',
  'binan': 'Laguna',
  'san pedro': 'Laguna',
  'cabuyao': 'Laguna',
  'los baños': 'Laguna',
  'los banos': 'Laguna',
  'antipolo': 'Rizal',
  'cainta': 'Rizal',
  'taytay': 'Rizal',
  'batangas': 'Batangas',
  'lipa': 'Batangas',
  'tanauan': 'Batangas'
};

function normalizeProvince(city, regionName) {
  if (!city && !regionName) return '';
  const cLower = (city || '').trim().toLowerCase();
  if (CITY_PROVINCE_MAP[cLower]) {
    return CITY_PROVINCE_MAP[cLower];
  }
  if (!regionName) return '';
  const rLower = regionName.toLowerCase();
  if (rLower === 'calabarzon' || rLower === 'region iv-a') {
    return 'Cavite'; // Default regional fallback for NCST campus vicinity
  }
  if (rLower === 'national capital region' || rLower === 'ncr') {
    return 'Metro Manila';
  }
  return regionName.trim();
}

function isPrivateIp(ip) {
  if (!ip) return true;
  const clean = ip.replace(/^::ffff:/, '').trim();
  if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') return true;
  if (/^10\./.test(clean)) return true;
  if (/^192\.168\./.test(clean)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(clean)) return true;
  if (/^fc00:/.test(clean) || /^fe80:/.test(clean)) return true;
  return false;
}

function extractClientIp(req) {
  if (!req) return '127.0.0.1';
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const parts = forwarded.split(',');
    if (parts.length > 0 && parts[0].trim()) {
      return parts[0].trim().replace(/^::ffff:/, '');
    }
  }
  const realIp = req.headers['x-real-ip'];
  if (realIp) return realIp.trim().replace(/^::ffff:/, '');
  const socketIp = req.socket?.remoteAddress || req.ip || '127.0.0.1';
  return socketIp.replace(/^::ffff:/, '');
}

/**
 * Reverse geocodes GPS coordinates into human-readable landmark, street, barangay, city, province.
 */
async function reverseGeocodeGps(latitude, longitude) {
  const lat = parseFloat(latitude);
  const lon = parseFloat(longitude);
  if (isNaN(lat) || isNaN(lon)) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'NCST-GadgetGuard/2.0 (osa@ncst.edu.ph)'
      }
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const data = await res.json();
    const addr = data.address || {};

    // 1. Identify landmark / place name
    let placeName = data.name || addr.shop || addr.amenity || addr.building || 
                    addr.leisure || addr.tourism || addr.mall || addr.commercial || '';

    const suburb = addr.quarter || addr.suburb || addr.neighbourhood || addr.village || '';
    const road = addr.road || addr.pedestrian || '';

    // If no explicit landmark name, use suburb/barangay or street
    if (!placeName && suburb) {
      placeName = suburb;
    } else if (!placeName && road) {
      placeName = road;
    }

    // 2. City / Municipality
    const city = addr.city || addr.municipality || addr.town || addr.city_district || '';

    // 3. Province
    let province = addr.state || addr.province || addr.county || '';
    if (addr['ISO3166-2-lvl4'] === 'PH-CAV' || province.toLowerCase() === 'calabarzon') {
      province = normalizeProvince(city, province) || 'Cavite';
    }

    // Deduplicate if placeName is identical to city
    if (placeName && city && placeName.toLowerCase() === city.toLowerCase()) {
      placeName = suburb !== city ? suburb : '';
    }

    const parts = [];
    if (placeName) parts.push(placeName);
    if (city) parts.push(city);
    if (province && province.toLowerCase() !== city.toLowerCase()) parts.push(province);

    const formattedLocation = parts.length > 0 
      ? `Approximate Location: ${parts.join(', ')}`
      : `Approximate Location: Coordinates ${lat.toFixed(4)}, ${lon.toFixed(4)}`;

    return {
      success: true,
      source: 'GPS',
      prefix: 'Approximate Location',
      formattedLocation,
      placeName: placeName || null,
      city: city || null,
      province: province || null,
      country: addr.country || 'Philippines',
      latitude: lat,
      longitude: lon
    };
  } catch (err) {
    // If Nominatim fails or times out, fallback gracefully with coordinates
    return {
      success: true,
      source: 'GPS',
      prefix: 'Approximate Location',
      formattedLocation: `Approximate Location: Coordinates ${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      placeName: null,
      city: null,
      province: null,
      country: 'Philippines',
      latitude: lat,
      longitude: lon
    };
  }
}

/**
 * Resolves IP-based estimated location.
 * STRICT RULE: Never invents a landmark or exact street. Only uses returned city and province.
 */
async function resolveIpLocation(ip) {
  try {
    const isLocal = isPrivateIp(ip);
    // If local/private IP (e.g. localhost testing), lookup public server IP
    const targetUrl = isLocal
      ? 'http://ip-api.com/json/?fields=status,message,country,regionName,city,lat,lon'
      : `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,regionName,city,lat,lon`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`ip-api HTTP ${res.status}`);
    const data = await res.json();

    if (data.status === 'success' && data.city) {
      const city = data.city;
      const province = normalizeProvince(city, data.regionName);

      const parts = [];
      if (city) parts.push(city);
      if (province && province.toLowerCase() !== city.toLowerCase()) parts.push(province);

      const formattedLocation = parts.length > 0
        ? `Estimated Location: ${parts.join(', ')}`
        : `Estimated Location: ${data.country || 'Philippines'}`;

      return {
        success: true,
        source: 'IP',
        prefix: 'Estimated Location',
        formattedLocation,
        placeName: null, // Strictly null: Never invent a landmark for IP results!
        city: city || null,
        province: province || null,
        country: data.country || 'Philippines',
        latitude: typeof data.lat === 'number' ? data.lat : null,
        longitude: typeof data.lon === 'number' ? data.lon : null
      };
    }
  } catch (e) {
    // IP lookup failed
  }

  return null;
}

/**
 * Main Location Resolver
 * Priority:
 * 1. GPS (if latitude & longitude provided) -> "Approximate Location: [Landmark], [City], [Province]"
 * 2. IP Fallback -> "Estimated Location: [City], [Province]"
 * 3. Fallback -> "Location unavailable"
 */
async function resolveScanLocation({ latitude, longitude, ip }) {
  // 1. Try GPS reverse geocoding if coordinates provided
  if (latitude !== undefined && latitude !== null && 
      longitude !== undefined && longitude !== null &&
      String(latitude).trim() !== '' && String(longitude).trim() !== '') {
    const gpsResult = await reverseGeocodeGps(latitude, longitude);
    if (gpsResult && gpsResult.success) {
      return gpsResult;
    }
  }

  // 2. Fallback to IP-based estimation
  if (ip) {
    const ipResult = await resolveIpLocation(ip);
    if (ipResult && ipResult.success) {
      return ipResult;
    }
  }

  // 3. Fallback when both fail
  return {
    success: false,
    source: null,
    prefix: null,
    formattedLocation: 'Location unavailable',
    placeName: null,
    city: null,
    province: null,
    country: null,
    latitude: null,
    longitude: null
  };
}

module.exports = {
  resolveScanLocation,
  reverseGeocodeGps,
  resolveIpLocation,
  extractClientIp,
  isPrivateIp
};
