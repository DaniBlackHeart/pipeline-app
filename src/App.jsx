import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { ChatUnreadProvider } from './context/ChatUnreadContext'
import AppShell from './components/AppShell'
import AuthPage from './pages/AuthPage'
import ShareView from './pages/ShareView'

// Route-level code splitting: each page ships as its own chunk, loaded on
// first visit rather than all bundled into the initial download.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const NewProject = lazy(() => import('./pages/NewProject'))
const MyTasks = lazy(() => import('./pages/MyTasks'))
const Clients = lazy(() => import('./pages/Clients'))
const ClientDetail = lazy(() => import('./pages/ClientDetail'))
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
const Chat = lazy(() => import('./pages/Chat'))
const Admin = lazy(() => import('./pages/Admin'))
const TaskTemplates = lazy(() => import('./pages/TaskTemplates'))
const TaskTemplateDetail = lazy(() => import('./pages/TaskTemplateDetail'))
const Onboarding = lazy(() => import('./pages/Onboarding'))

function PageFallback() {
  return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>
}

function ProtectedRoute({ children }) {
  const { user, loading, needsMfaChallenge, needsOnboarding } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  // A session existing isn't enough if this account has MFA enrolled and
  // the second factor hasn't been verified yet this session — otherwise
  // navigating straight to a URL (not just the login form) would skip the
  // challenge entirely. AuthPage renders the actual challenge screen.
  if (needsMfaChallenge) return <Navigate to="/login" replace />
  // First-time (or hasn't-dismissed-it-yet) users land on /welcome before
  // anything else in the app, same shape as the MFA gate above. Checked
  // after MFA on purpose — a still-pending second factor takes priority.
  if (needsOnboarding) return <Navigate to="/welcome" replace />

  return (
    <AppShell>
      <Suspense fallback={<PageFallback />}>{children}</Suspense>
    </AppShell>
  )
}

// The onboarding page itself needs the same auth/MFA gating as everything
// else (no anonymous access, no skipping a pending 2FA challenge to get
// here) but deliberately doesn't check needsOnboarding -- that's the flag
// this very page exists to clear -- and doesn't wrap in AppShell, since
// the point is a full-bleed, nav-free walkthrough rather than another page
// inside the normal app chrome.
function OnboardingRoute({ children }) {
  const { user, loading, needsMfaChallenge } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  if (needsMfaChallenge) return <Navigate to="/login" replace />

  return <Suspense fallback={<PageFallback />}>{children}</Suspense>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/share/:token" element={<ShareView />} />
      <Route path="/welcome" element={<OnboardingRoute><Onboarding /></OnboardingRoute>} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/projects/new" element={<ProtectedRoute><NewProject /></ProtectedRoute>} />
      <Route path="/my-tasks" element={<ProtectedRoute><MyTasks /></ProtectedRoute>} />
      <Route path="/clients" element={<ProtectedRoute><Clients /></ProtectedRoute>} />
      <Route path="/clients/:clientId" element={<ProtectedRoute><ClientDetail /></ProtectedRoute>} />
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
      <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
      <Route path="/task-templates" element={<ProtectedRoute><TaskTemplates /></ProtectedRoute>} />
      <Route path="/task-templates/:templateId" element={<ProtectedRoute><TaskTemplateDetail /></ProtectedRoute>} />
      {/* Route-level guarding is a UI nicety only -- the real check is
          server-side in api/admin.js (requirePlatformAdmin). Landing here
          without being the platform admin just gets a 403 from every call
          the page makes, same principle as every other ProtectedRoute here
          not being the actual security boundary for its own data. */}
      <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <ChatUnreadProvider>
            <AppRoutes />
          </ChatUnreadProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
