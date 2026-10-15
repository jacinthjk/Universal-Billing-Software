import axios from 'axios'

const TOKEN_KEY = 'ubb_token'
const BUSINESS_KEY = 'ubb_business'

const safe = (fn, fallback = null) => {
  try { return fn() } catch { return fallback }
}

export const session = {
  get token() { return safe(() => localStorage.getItem(TOKEN_KEY)) },
  set token(v) { safe(() => (v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY))) },
  get businessId() { return safe(() => localStorage.getItem(BUSINESS_KEY)) },
  set businessId(v) { safe(() => (v ? localStorage.setItem(BUSINESS_KEY, v) : localStorage.removeItem(BUSINESS_KEY))) },
}

export const API_URL = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({ baseURL: API_URL, timeout: 60000 })

// Every request carries the JWT and the active business (tenant) id; the server re-checks membership.
api.interceptors.request.use((config) => {
  const t = session.token
  if (t) config.headers.Authorization = `Bearer ${t}`
  const b = session.businessId
  if (b && !config.headers['X-Business-Id']) config.headers['X-Business-Id'] = b
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && session.token) {
      session.token = null
      if (!location.pathname.startsWith('/login')) location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export const errMsg = (e) => e?.response?.data?.error || e?.message || 'Something went wrong'

// Fetch an authenticated binary (invoice PDF/PNG, report) and open or download it.
export async function openFile(url, { download = false, filename } = {}) {
  const res = await api.get(url, { responseType: 'blob' })
  const blobUrl = URL.createObjectURL(res.data)
  if (download) {
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename || 'download'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } else {
    window.open(blobUrl, '_blank', 'noopener')
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
}

export async function fetchBlob(url) {
  const res = await api.get(url, { responseType: 'blob' })
  return res.data
}

// Public (storefront) client: no auth headers.
export const publicApi = axios.create({ baseURL: `${API_URL}/public`, timeout: 60000 })

export default api
