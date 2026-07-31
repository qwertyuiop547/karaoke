import { useEffect, useState } from 'react'
import AdminLogin from './AdminLogin'
import AdminDashboard from './admin/AdminDashboard'
import { adminMe } from './api'

export default function AdminGate({ onBack }) {
  const [checking, setChecking] = useState(true)
  const [user, setUser] = useState(null)

  const refresh = async () => {
    setChecking(true)
    try {
      const me = await adminMe()
      if (me?.authenticated && me?.is_staff) {
        setUser(me)
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  if (checking) {
    return (
      <div className="admin-login-page">
        <p className="admin-checking">Checking admin session…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <AdminLogin
        onBack={onBack}
        onSuccess={(data) => {
          setUser({
            authenticated: true,
            username: data.username,
            is_superuser: data.is_superuser,
            is_staff: true,
          })
        }}
      />
    )
  }

  return (
    <AdminDashboard
      user={user}
      onBack={onBack}
      onLogout={() => {
        setUser(null)
        onBack()
      }}
    />
  )
}
