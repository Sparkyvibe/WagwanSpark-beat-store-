export default {
  async fetch(request) {
    return new Response('WagwanSpark Beat Store - Static Site Deployment', {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};