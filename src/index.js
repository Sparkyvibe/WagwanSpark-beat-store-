export default {
  async fetch(request) {
    return new Response('Weather Dashboard - Static Site Deployment', {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};