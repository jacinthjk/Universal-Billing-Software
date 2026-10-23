import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import Onboarding from './pages/Onboarding'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Staff = lazy(() => import('./pages/Staff'))
const Bank = lazy(() => import('./pages/Bank'))
const POS = lazy(() => import('./pages/POS'))
const Sales = lazy(() => import('./pages/Sales'))
const SaleDetail = lazy(() => import('./pages/SaleDetail'))
const Products = lazy(() => import('./pages/Products'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Purchases = lazy(() => import('./pages/Purchases'))
const Customers = lazy(() => import('./pages/Customers'))
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'))
const Enquiries = lazy(() => import('./pages/Enquiries'))
const EnquiryDetail = lazy(() => import('./pages/EnquiryDetail'))
const Orders = lazy(() => import('./pages/Orders'))
const OrderDetail = lazy(() => import('./pages/OrderDetail'))
const Reports = lazy(() => import('./pages/Reports'))
const Website = lazy(() => import('./pages/Website'))
const AIAssistant = lazy(() => import('./pages/AIAssistant'))
const Settings = lazy(() => import('./pages/Settings'))
const WhatsApp = lazy(() => import('./pages/WhatsApp'))
const Admin = lazy(() => import('./pages/Admin'))
const Verify = lazy(() => import('./pages/Verify'))
const Store = lazy(() => import('./store/Store'))

function Private({ children }) {
  const { user, business, loading } = useAuth()
  if (loading) return <Spinner className="h-full items-center" />
  if (!user) return <Navigate to="/login" replace />
  if (!business) return <Navigate to="/onboarding" replace />
  return children
}

export default function App() {
  const { user, loading } = useAuth()
  return (
    <Suspense fallback={<Spinner className="h-full items-center" />}>
      <Routes>
        {/* Public */}
        <Route path="/s/:slug/*" element={<Store />} />
        <Route path="/verify/:token" element={<Verify />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/onboarding" element={loading ? <Spinner /> : user ? <Onboarding /> : <Navigate to="/login" replace />} />

        {/* Business workspace */}
        <Route element={<Private><Layout /></Private>}>
          <Route index element={<Dashboard />} />
          <Route path="pos" element={<POS />} />
          <Route path="sales" element={<Sales />} />
          <Route path="sales/:id" element={<SaleDetail />} />
          <Route path="products" element={<Products />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="purchases/*" element={<Purchases />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/:id" element={<CustomerDetail />} />
          <Route path="enquiries" element={<Enquiries />} />
          <Route path="enquiries/:id" element={<EnquiryDetail />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="reports" element={<Reports />} />
          <Route path="website" element={<Website />} />
          <Route path="ai" element={<AIAssistant />} />
          <Route path="settings" element={<Settings />} />
          <Route path="whatsapp" element={<WhatsApp />} />
          <Route path="staff" element={<Staff />} />
          <Route path="bank" element={<Bank />} />
          <Route path="admin" element={<Admin />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
