'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Employee } from '@/types'

interface Props {
  employees: Employee[]
  currentManagerId: string
}

interface AddForm {
  name: string
  email: string
  is_new_employee: boolean
}

const EMPTY_FORM: AddForm = { name: '', email: '', is_new_employee: false }

export default function ManagerEmployeesClient({ employees: initial, currentManagerId }: Props) {
  const [employees, setEmployees] = useState(initial)
  const [loading, setLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_FORM)
  const [addLoading, setAddLoading] = useState(false)

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

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddLoading(true)
    const res = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    })
    const json = await res.json()
    if (!res.ok) {
      showToast('error', json.error ?? 'Failed to add employee')
    } else {
      setEmployees((prev) => [...prev, json.employee].sort((a, b) => a.name.localeCompare(b.name)))
      setAddForm(EMPTY_FORM)
      setShowAddForm(false)
      showToast('success', `${json.employee.name} added`)
    }
    setAddLoading(false)
  }

  const visible = employees.filter(e => showInactive ? true : e.is_active !== false)
  const inactiveCount = employees.filter(e => e.is_active === false).length

  return (
    <div>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      {/* Add Employee Form */}
      <div className="mb-4">
        {!showAddForm ? (
          <button
            onClick={() => setShowAddForm(true)}
            className="bg-[#1B3A5C] hover:bg-[#2a4a6b] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Add Employee
          </button>
        ) : (
          <form onSubmit={handleAdd} className="bg-white border border-gray-200 rounded-xl p-5 mb-2">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">New Employee</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Full name"
                  className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={addForm.email}
                  onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="email@example.com"
                  className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 mb-5">
              <input
                id="add-new-employee"
                type="checkbox"
                checked={addForm.is_new_employee}
                onChange={e => setAddForm(f => ({ ...f, is_new_employee: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="add-new-employee" className="text-sm text-gray-700">New employee (lighter scheduling)</label>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={addLoading}
                className="bg-[#1B3A5C] hover:bg-[#2a4a6b] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {addLoading ? 'Adding…' : 'Add Employee'}
              </button>
              <button
                type="button"
                onClick={() => { setShowAddForm(false); setAddForm(EMPTY_FORM) }}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Active / inactive toggle */}
      {inactiveCount > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={() => setShowInactive(v => !v)}
            className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
          >
            {showInactive ? 'Hide inactive' : `Show ${inactiveCount} inactive employee${inactiveCount !== 1 ? 's' : ''}`}
          </button>
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
              <th className="text-left px-4 py-3 font-medium text-gray-600">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visible.map((emp) => {
              const inactive = emp.is_active === false
              return (
                <tr key={emp.id} className={inactive ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      {emp.name}
                      {inactive && (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-200 text-gray-500">Inactive</span>
                      )}
                    </div>
                  </td>
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
                      checked={!!emp.is_new_employee}
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
                  <td className="px-4 py-3">
                    <button
                      disabled={loading === emp.id}
                      onClick={() => updateEmployee(emp.id, { is_active: !emp.is_active })}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50 ${
                        emp.is_active !== false ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                          emp.is_active !== false ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {visible.length === 0 && (
          <div className="text-center py-10 text-sm text-gray-400">No employees found</div>
        )}
      </div>
    </div>
  )
}
