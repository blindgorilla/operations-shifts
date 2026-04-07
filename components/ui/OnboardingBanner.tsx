'use client'

import { useState } from 'react'

interface OnboardingBannerProps {
  role: 'employee' | 'manager'
}

const EMPLOYEE_STEPS = [
  { icon: '📅', title: 'Browse available shifts', desc: 'The manager publishes shifts here. You can see the date, time, location and type of each shift.' },
  { icon: '✋', title: 'Request a shift', desc: 'Click Request on any shift you want. Add an optional note for your manager. The app will check scheduling rules automatically.' },
  { icon: '📬', title: 'Wait for approval', desc: 'Your manager reviews your request and approves or denies it. You will receive an email either way.' },
  { icon: '✅', title: 'Check My Requests', desc: 'Track the status of all your requests at any time under the My Requests tab.' },
]

const MANAGER_STEPS = [
  { icon: '➕', title: 'Create shifts', desc: 'Go to Shifts → New Shift. Set the date, type (morning/evening/night), location, role, and how many employees can fill it.' },
  { icon: '📢', title: 'Publish shifts', desc: 'Shifts start as drafts. When ready, publish them so employees can see and request them.' },
  { icon: '📋', title: 'Review requests', desc: 'Go to Requests to see all pending employee requests. The app flags any scheduling rule violations automatically.' },
  { icon: '✉️', title: 'Approve or deny', desc: 'Approve or deny each request with an optional note. The employee gets an email notification instantly.' },
]

export default function OnboardingBanner({ role }: OnboardingBannerProps) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(`onboarding_dismissed_${role}`) === 'true'
  })

  function dismiss() {
    localStorage.setItem(`onboarding_dismissed_${role}`, 'true')
    setDismissed(true)
  }

  if (dismissed) return null

  const steps = role === 'manager' ? MANAGER_STEPS : EMPLOYEE_STEPS
  const title = role === 'manager'
    ? 'Welcome, Manager — here is how Operations Shifts works'
    : 'Welcome to Operations Shifts — here is how it works'

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-semibold text-blue-900 text-base">{title}</h2>
          <p className="text-sm text-blue-700 mt-0.5">
            {role === 'manager'
              ? 'You have full access to create shifts, manage employees, and approve requests.'
              : 'You can browse available shifts and request the ones you want to work.'}
          </p>
        </div>
        <button
          onClick={dismiss}
          className="text-blue-400 hover:text-blue-600 shrink-0 text-xs font-medium"
        >
          Dismiss
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {steps.map((step, i) => (
          <div key={i} className="bg-white rounded-lg p-3 border border-blue-100">
            <div className="text-xl mb-1">{step.icon}</div>
            <p className="text-sm font-semibold text-gray-800 mb-0.5">
              <span className="text-blue-400 mr-1">{i + 1}.</span>{step.title}
            </p>
            <p className="text-xs text-gray-500 leading-relaxed">{step.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
