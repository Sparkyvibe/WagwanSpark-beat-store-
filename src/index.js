export default {
  async fetch(request, env) {
    // Let Wrangler's static file handler serve the public directory
    return env.ASSETS.fetch(request);
  },
};
