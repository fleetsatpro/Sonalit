'use strict';

/**
 * Resolve the geo routing providers from the environment, so the map-matcher
 * (device trails) and the route planner (4D corridors) read them identically.
 *
 * The Mapbox token is accepted under any of the common names people reach for,
 * so a token set on the host is picked up whatever it was called.
 */
function mapboxToken() {
  return process.env.MAPBOX_TOKEN ||
    process.env.MAPBOX_ACCESS_TOKEN ||
    process.env.MAPBOX_API_KEY ||
    process.env.MAPBOX_KEY ||
    '';
}

// Dedicated matcher/router if provided, else the public OSRM demo server.
function osrmUrl() {
  return process.env.OSRM_URL || 'https://router.project-osrm.org';
}

module.exports = { mapboxToken, osrmUrl };
