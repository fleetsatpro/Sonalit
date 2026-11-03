/*
 * Compatibility preload for the Vercel build environment.
 *
 * NODE_OPTIONS in the connected Vercel project preloads this module before
 * package installation. Keep the module dependency-free and side-effect free
 * so the build can start even when the optional runtime patch set is absent.
 */
