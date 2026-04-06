'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Employee } from '@/types'

interface Props {
  employees: Employee[]
  currentManagerId: string
}

export default function ManagerEmployeesClient({ employees: initial, currentManagerId }: Props) {
  const [employees, setEmployees] = useState(initial)
  const [loading, setLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3000)
  }

  async function updateEmployee(id: string, updates: Partial<Employee>) {
    setLoading(id)
    const supabase = createClient()
    const { error } = await supabase.from('employees').update(updates).eq('id', id)

    if (error) {
      showToast('error', error.message)
    } else {
      setEmployees((prev) => prev.map((e) => e.id === id ? { ...e, ...updates } : e))
      showToast('success', 'Employee updated')
    }
    setLoading(null)
  }

  return (
    <div>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">New Employee</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Weekly Days</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {employees.map((emp) => (
              <tr key={emp.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{emp.name}</td>
                <td className="px-4 py-3 text-gray-600">{emp.email}</td>
                <td className="px-4 py-3">
                  <select
                    value={emp.role}
                    disabled={emp.id === currentManagerId || loading === emp.id}
                    onChange={(e) => updateEmployee(emp.id, { role: e.target.value as 'employee' | 'manager' })}
                    className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={emp.is_new_employee}
                    disabled={loading === emp.id}
                    onChange={(e) => updateEmployee(emp.id, { is_new_employee: e.target.checked })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </td>
                <td className="px-4 py-3">
                  <select
                    value={emp.weekly_days}
                    disabled={loading === emp.id}
                    onChange={(e) => updateEmployee(emp.id, { weekly_days: parseInt(e.target.value) as 4 | 5 })}
                    className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={4}>4 days</option>
                    <option value={5}>5 days</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
