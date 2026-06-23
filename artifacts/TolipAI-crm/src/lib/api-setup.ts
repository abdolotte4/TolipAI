/**
 * Global fetch interceptor to inject the JWT auth token
 * and handle 401 unauthenticated responses cleanly.
 */
export function setupFetchInterceptor() {
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    let [resource, config] = args;
    if (typeof resource === 'string' && resource.startsWith('/api/')) {
      const token = localStorage.getItem('crm_token');
      if (token) {
        config = config || {};
        config.headers = {
          ...config.headers,
          Authorization: `Bearer ${token}`,
        };
      }
    }
    const response = await originalFetch(resource, config);
    const url = typeof resource === 'string' ? resource : '';
    const isCrmRoute = url.startsWith('/api/crm/');
    if (response.status === 401 && isCrmRoute && !url.includes('/auth/login')) {
      localStorage.removeItem('crm_token');
      window.location.href = import.meta.env.BASE_URL + 'login';
    }
    return response;
  };
}
