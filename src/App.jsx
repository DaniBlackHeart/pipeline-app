import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import AppShell from './components/AppShell'
import AuthPage from './pages/AuthPage'
import ShareView from './pages/ShareView'

// Route-level code splitting: each page ships as its own chunk, loaded on
// first visit rather than all bundled into the initial download.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const MyTasks = lazy(() => import('./pages/MyTasks'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'))
const TaskDetail = lazy(() => import('./pages/TaskDetail'))
const Calendar = lazy(() => import('./pages/Calendar'))
const Tickets = lazy(() => import('./pages/Tickets'))
const TicketForm = lazy(() => import('./pages/TicketForm'))
const TicketDetail = lazy(() => import('./pages/TicketDetail'))
const Invoices = lazy(() => import('./pages/Invoices'))
const InvoiceForm = lazy(() => import('./pages/InvoiceForm'))
const InvoiceDetail = lazy(() => import('./pages/InvoiceDetail'))
const RecurringInvoices = lazy(() => import('./pages/RecurringInvoices'))
const RecurringInvoiceForm = lazy(() => import('./pages/RecurringInvoiceForm'))
const Settings = lazy(() => import('./pages/Settings'))
const Reports = lazy(() => import('./pages/Reports'))
const Team = lazy(() => import('./pages/Team'))

function PageFallback() {
  return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return (
    <AppShell>
      <Suspense fallback={<PageFallback />}>{children}</Suspense>
    </AppShell>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/share/:token" element={<ShareView />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/my-tasks" element={<ProtectedRoute><MyTasks /></ProtectedRoute>} />
      <Route path="/projects/:projectId" element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>} />
      <Route path="/tasks/:taskId" element={<ProtectedRoute><TaskDetail /></ProtectedRoute>} />
      <Route path="/calendar" element={<ProtectedRoute><Calendar /></ProtectedRoute>} />
      <Route path="/tickets" element={<ProtectedRoute><Tickets /></ProtectedRoute>} />
      <Route path="/tickets/new" element={<ProtectedRoute><TicketForm /></ProtectedRoute>} />
      <Route path="/tickets/:ticketId" element={<ProtectedRoute><TicketDetail /></ProtectedRoute>} />
      <Route path="/tickets/:ticketId/edit" element={<ProtectedRoute><TicketForm /></ProtectedRoute>} />
      <Route path="/invoices" element={<ProtectedRoute><Invoices /></ProtectedRoute>} />
      <Route path="/invoices/recurring" element={<ProtectedRoute><RecurringInvoices /></ProtectedRoute>} />
      <Route path="/invoices/recurring/new" element={<ProtectedRoute><RecurringInvoiceForm /></ProtectedRoute>} />
      <Route path="/invoices/recurring/:templateId/edit" element={<ProtectedRoute><RecurringInvoiceForm /></ProtectedRoute>} />
      <Route path="/invoices/new" element={<ProtectedRoute><InvoiceForm /></ProtectedRoute>} />
      <Route path="/invoices/:invoiceId" element={<ProtectedRoute><InvoiceDetail /></ProtectedRoute>} />
      <Route path="/invoices/:invoiceId/edit" element={<ProtectedRoute><InvoiceForm /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
      <Route path="/team" element={<ProtectedRoute><Team /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
