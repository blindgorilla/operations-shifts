'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Employee } from '@/types'
import NotificationDropdown from '@/components/ui/NotificationDropdown'



interface NavBarProps {
  employee: Employee
  pendingCount?: number
}

export default function NavBar({ employee, pendingCount: initialCount = 0 }: NavBarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [pendingCount, setPendingCount] = useState(initialCount)

  useEffect(() => {
    setPendingCount(initialCount)
  }, [initialCount])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  type NavLink = { href: string; label: string; badge?: number }

  const employeeLinks: NavLink[] = [
    { href: '/dashboard', label: 'Calendar' },
    { href: '/my-requests', label: 'My Requests' },
  ]

  const managerLinks: NavLink[] = [
    { href: '/manager/shifts', label: 'Shifts' },
    { href: '/manager/requests', label: 'Requests', badge: pendingCount },
    { href: '/manager/employees', label: 'Employees' },
    { href: '/manager/holidays', label: 'Holidays' },
    { href: '/manager/rules', label: 'Rules' },
  ]

  const links: NavLink[] = employee.role === 'manager' ? [...employeeLinks, ...managerLinks] : employeeLinks

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Brand */}
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2 text-blue-600 font-semibold text-sm">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Operations Shifts
            </Link>

            <nav className="hidden sm:flex items-center gap-1">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    pathname === link.href
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  {link.label}
                  {link.badge !== undefined && link.badge > 0 && (
                    <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                      {link.badge > 9 ? '9+' : link.badge}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
          </div>

          {/* User */}
          <div className="flex items-center gap-3">
            {/* Bell notification dropdown for managers */}
            {employee.role === 'manager' && (
              <NotificationDropdown initialCount={pendingCount} />
            )}

            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-gray-900">{employee.name}</p>
              <p className="text-xs text-gray-500 capitalize">{employee.role}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="text-sm text-gray-500 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
