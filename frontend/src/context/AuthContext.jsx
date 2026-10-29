import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api, { session } from '../lib/api'
import { applyTheme, setFavicon } from '../lib/theme'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [businesses, setBusinesses] = useState([])
  const [current, setCurrent] = useState(null) // { business, role, permissions, websiteUrl }
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadBusiness = useCallback(async (id) => {
    session.businessId = id
    let data
    try {
      ({ data } = await api.get('/businesses/current', { headers: { 'X-Business-Id': id } }))
    } catch (e) {
      // A preview of a role that no longer exists: drop it and load normally.
      if (!session.previewRole) throw e
      session.previewRole = null
      ;({ data } = await api.get('/businesses/current', { headers: { 'X-Business-Id': id } }))
    }
    setCurrent(data)
    applyTheme(data.business.theme)
    setFavicon(data.business.logoUrl)
    document.title = `${data.business.name} · BizOS`
    return data
  }, [])

  const bootstrap = useCallback(async () => {
    if (!session.token) {
      setLoading(false)
      return
    }
    try {
      const [{ data: me }, { data: m }] = await Promise.all([api.get('/auth/me'), api.get('/businesses/meta')])
      setUser(me.user)
      setBusinesses(me.businesses)
      setMeta(m)
      const preferred = me.businesses.find((b) => b.businessId === session.businessId) || me.businesses[0]
      if (preferred) await loadBusiness(preferred.businessId)
      else session.businessId = null
    } catch {
      session.token = null
    } finally {
      setLoading(false)
    }
  }, [loadBusiness])

  useEffect(() => { bootstrap() }, [bootstrap])

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password })
    session.token = data.token
    setLoading(true)
    await bootstrap()
    return data
  }

  const register = async (payload) => {
    const { data } = await api.post('/auth/register', payload)
    session.token = data.token
    setLoading(true)
    await bootstrap()
    return data
  }

  const logout = () => {
    session.token = null
    session.businessId = null
    session.previewRole = null
    setUser(null)
    setCurrent(null)
    setBusinesses([])
    applyTheme({})
  }

  const refreshMemberships = async () => {
    const { data } = await api.get('/auth/me')
    setBusinesses(data.businesses)
    return data.businesses
  }

  const switchBusiness = async (id) => {
    session.previewRole = null
    await loadBusiness(id)
  }

  // See the portal as another role (read-only); pass null to return to your own view.
  const previewAs = async (roleId) => {
    session.previewRole = roleId || null
    if (current) await loadBusiness(current.business.id)
  }

  const refreshBusiness = async () => {
    if (current) await loadBusiness(current.business.id)
    await refreshMemberships()
  }

  const value = useMemo(() => {
    const perms = current?.permissions || []
    const business = current?.business
    return {
      user, businesses, business, role: current?.role, permissions: perms, websiteUrl: current?.websiteUrl, meta, loading, preview: current?.preview || null,
      can: (...p) => perms.includes('*') || p.some((x) => perms.includes(x)),
      hasModule: (m) => !!business?.settings?.modules?.includes(m),
      t: (key) => business?.terminology?.[key] || key,
      currency: business?.currency || 'INR',
      login, register, logout, switchBusiness, refreshBusiness, refreshMemberships, setUser, previewAs,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, businesses, current, meta, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
