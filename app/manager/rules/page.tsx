'use client'

import Link from 'next/link'
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

  const activeRuleCount = rules.filter((rule) => rule.is_enabled).length
  const warningRuleCount = rules.filter((rule) => rule.severity === 'warning').length

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
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-5 mb-8 border-b border-slate-200 pb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
            >
              ← Back to dashboard
            </Link>
            <h1 className="text-3xl font-semibold mt-3 text-slate-900">Scheduling Rules Management</h1>
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            Add New Rule
          </button>
        </div>
        <p className="max-w-3xl text-base leading-7 text-slate-600">
          Scheduling rules help define how shifts are assigned, validated, and reviewed by managers. Adjust rules here to keep the schedule aligned with operational priorities.
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <div className="rounded-full bg-slate-100 px-4 py-2 text-slate-700">
            {activeRuleCount} active rule{activeRuleCount === 1 ? '' : 's'}
          </div>
          <div className="rounded-full bg-amber-100 px-4 py-2 text-amber-800">
            {warningRuleCount} warning rule{warningRuleCount === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-xl"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <h3 className="text-xl font-semibold text-slate-900 truncate">{rule.display_name}</h3>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    rule.severity === 'error'
                      ? 'bg-red-50 text-red-700 ring-1 ring-red-100'
                      : 'bg-amber-50 text-amber-800 ring-1 ring-amber-100'
                  }`}>
                    {rule.severity === 'error' ? 'Error Rule' : 'Warning Rule'}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    rule.is_enabled
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                      : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
                  }`}>
                    {rule.is_enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className="text-slate-600 mb-5 leading-7">{rule.description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleEdit(rule)}
                  className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Edit
                </button>
                <button
                  onClick={() => toggleRule(rule)}
                  className={`inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition ${
                    rule.is_enabled
                      ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  {rule.is_enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => handleDelete(rule.id)}
                  className="inline-flex items-center justify-center rounded-full bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 text-sm text-slate-600">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[0.82rem] font-semibold uppercase tracking-[0.15em] text-slate-500">Type</p>
                <p className="mt-2 text-slate-900">{getRuleType(rule)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[0.82rem] font-semibold uppercase tracking-[0.15em] text-slate-500">Affects</p>
                <p className="mt-2 text-slate-900">{getRuleAffects(rule)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[0.82rem] font-semibold uppercase tracking-[0.15em] text-slate-500">Last updated</p>
                <p className="mt-2 text-slate-900">{formatDate(rule.updated_at)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[0.82rem] font-semibold uppercase tracking-[0.15em] text-slate-500">Rule key</p>
                <p className="mt-2 text-slate-900">{rule.name}</p>
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
                  className="flex-1 bg-[#1B3A5C] text-white py-2 rounded hover:bg-[#2a4a6b]"
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