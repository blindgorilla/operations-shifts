'use client'

import { useState, useEffect } from 'react'
import type { SchedulingRule } from '@/types'

export default function RulesPage() {
  const [rules, setRules] = useState<SchedulingRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingRule, setEditingRule] = useState<SchedulingRule | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    display_name: '',
    description: '',
    severity: 'warning' as 'error' | 'warning',
    is_enabled: true,
    parameters: '{}'
  })

  const getRuleType = (rule: SchedulingRule) => {
    if (rule.name === 'fairness_info' || rule.name === 'night_rest_preference') return 'Advisory'
    if (rule.severity === 'error') return 'Hard Rule'
    return 'Soft Rule'
  }

  const getRuleAffects = (rule: SchedulingRule) => {
    switch (rule.name) {
      case 'headcount':
      case 'min_rest':
      case 'night_followup':
      case 'new_employee_pairing':
        return 'Shift assignment'
      case 'consecutive_days':
        return 'Schedule validation'
      case 'night_rest_preference':
      case 'fairness_info':
        return 'Manager override checks'
      default:
        return 'Schedule review'
    }
  }

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })

  useEffect(() => {
    fetchRules()
  }, [])

  const fetchRules = async () => {
    try {
      const response = await fetch('/api/rules')
      if (response.ok) {
        const data = await response.json()
        setRules(data)
      }
    } catch (error) {
      console.error('Error fetching rules:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const confirmed = confirm(
      'Saving this rule may affect future shift assignments, schedule validation, and manager override decisions. Continue?'
    )
    if (!confirmed) return

    try {
      const response = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          parameters: JSON.parse(formData.parameters)
        })
      })

      if (response.ok) {
        setShowCreateForm(false)
        setFormData({
          name: '',
          display_name: '',
          description: '',
          severity: 'warning',
          is_enabled: true,
          parameters: '{}'
        })
        fetchRules()
      }
    } catch (error) {
      console.error('Error creating rule:', error)
    }
  }

  const handleEdit = (rule: SchedulingRule) => {
    setEditingRule(rule)
    setFormData({
      name: rule.name,
      display_name: rule.display_name,
      description: rule.description,
      severity: rule.severity,
      is_enabled: rule.is_enabled,
      parameters: JSON.stringify(rule.parameters, null, 2)
    })
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingRule) return

    const confirmed = confirm(
      'Saving this rule may affect future shift assignments, schedule validation, and manager override decisions. Continue?'
    )
    if (!confirmed) return

    try {
      const response = await fetch(`/api/rules/${editingRule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          parameters: JSON.parse(formData.parameters)
        })
      })

      if (response.ok) {
        setEditingRule(null)
        setFormData({
          name: '',
          display_name: '',
          description: '',
          severity: 'warning',
          is_enabled: true,
          parameters: '{}'
        })
        fetchRules()
      }
    } catch (error) {
      console.error('Error updating rule:', error)
    }
  }

  const handleDelete = async (ruleId: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) return

    try {
      const response = await fetch(`/api/rules/${ruleId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        fetchRules()
      }
    } catch (error) {
      console.error('Error deleting rule:', error)
    }
  }

  const toggleRule = async (rule: SchedulingRule) => {
    try {
      const response = await fetch(`/api/rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: !rule.is_enabled })
      })

      if (response.ok) {
        fetchRules()
      }
    } catch (error) {
      console.error('Error toggling rule:', error)
    }
  }

  if (loading) {
    return <div className="p-6">Loading rules...</div>
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Scheduling Rules Management</h1>
        <button
          onClick={() => setShowCreateForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Add New Rule
        </button>
      </div>

      <div className="space-y-4">
        {rules.map((rule) => (
          <div key={rule.id} className="border rounded-lg p-4 bg-white shadow">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-lg font-semibold">{rule.display_name}</h3>
                  <span className={`px-2 py-1 text-xs rounded ${
                    rule.severity === 'error' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {rule.severity}
                  </span>
                  <span className={`px-2 py-1 text-xs rounded ${
                    rule.is_enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {rule.is_enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className="text-gray-600 mb-2">{rule.description}</p>
                <div className="grid gap-2 sm:grid-cols-2 text-sm text-slate-600 mb-2">
                  <div className="inline-flex items-center gap-2">
                    <span className="font-semibold">Type:</span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                      {getRuleType(rule)}
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-2">
                    <span className="font-semibold">Affects:</span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                      {getRuleAffects(rule)}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-slate-500 mb-2">
                  Updated by Manager · {formatDate(rule.updated_at)}
                </p>
                <p className="text-sm text-gray-500">Name: {rule.name}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => toggleRule(rule)}
                  className={`px-3 py-1 text-sm rounded ${
                    rule.is_enabled
                      ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                      : 'bg-green-100 text-green-800 hover:bg-green-200'
                  }`}
                >
                  {rule.is_enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => handleEdit(rule)}
                  className="px-3 py-1 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(rule.id)}
                  className="px-3 py-1 text-sm bg-red-100 text-red-800 rounded hover:bg-red-200"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(showCreateForm || editingRule) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">
              {editingRule ? 'Edit Rule' : 'Create New Rule'}
            </h2>
            <form onSubmit={editingRule ? handleUpdate : handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Display Name</label>
                <input
                  type="text"
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Severity</label>
                <select
                  value={formData.severity}
                  onChange={(e) => setFormData({ ...formData, severity: e.target.value as 'error' | 'warning' })}
                  className="w-full border rounded px-3 py-2"
                >
                  <option value="warning">Warning</option>
                  <option value="error">Error</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Parameters (JSON)</label>
                <textarea
                  value={formData.parameters}
                  onChange={(e) => setFormData({ ...formData, parameters: e.target.value })}
                  className="w-full border rounded px-3 py-2 font-mono text-sm"
                  rows={4}
                  placeholder='{}'
                />
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold mb-2">Impact Preview</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>This rule may affect future shift assignments.</li>
                  <li>It can change schedule validation results.</li>
                  <li>It influences manager override decisions.</li>
                </ul>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="is_enabled"
                  checked={formData.is_enabled}
                  onChange={(e) => setFormData({ ...formData, is_enabled: e.target.checked })}
                  className="mr-2"
                />
                <label htmlFor="is_enabled" className="text-sm">Enabled</label>
              </div>
              <div className="flex gap-2 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
                >
                  {editingRule ? 'Update' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateForm(false)
                    setEditingRule(null)
                    setFormData({
                      name: '',
                      display_name: '',
                      description: '',
                      severity: 'warning',
                      is_enabled: true,
                      parameters: '{}'
                    })
                  }}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 rounded hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}