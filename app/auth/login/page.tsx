'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    const supabase = createClient()

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      router.push('/dashboard')
      router.refresh()
    } else if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `https://operations-shifts.vercel.app/auth/callback?next=/auth/reset-password`,
      })
      if (error) { setError(error.message); setLoading(false); return }
      setSuccess('Password reset email sent. Check your inbox.')
      setLoading(false)
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
        },
      })
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      setSuccess('Account created! Check your email to confirm your account, then sign in.')
      setLoading(false)
      setMode('signin')
      setPassword('')
    }
  }

  function switchMode(newMode: 'signin' | 'signup' | 'forgot') {
    setMode(newMode)
    setError(null)
    setSuccess(null)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">

          {/* Logo / Title */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-xl mb-4">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Operations Shifts</h1>
          </div>

          {/* Tab switcher */}
          {mode === 'forgot' ? (
            <div className="mb-6">
              <button type="button" onClick={() => switchMode('signin')} className="text-sm text-gray-500 hover:text-gray-700">← Back to sign in</button>
            </div>
          ) : (
            <div className="flex rounded-lg border border-gray-200 p-1 mb-6">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  mode === 'signin'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  mode === 'signup'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Create account
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Name — only on signup */}
            {mode === 'signup' && (
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                  Full name
                </label>
                <input
                  id="name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Your full name"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="you@company.com"
              />
            </div>

            {mode !== 'forgot' && (
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                  Password {mode === 'signup' && <span className="text-gray-400 font-normal">(min. 6 characters)</span>}
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={mode === 'signup' ? 6 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="········"
                />
              </div>
            )}

            {mode === 'signin' && (
              <div className="text-right">
                <button type="button" onClick={() => switchMode('forgot')} className="text-xs text-blue-600 hover:underline">
                  Forgot password?
                </button>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
            >
              {loading
                ? mode === 'signin' ? 'Signing in...' : mode === 'forgot' ? 'Sending...' : 'Creating account...'
                : mode === 'signin' ? 'Sign in' : mode === 'forgot' ? 'Send reset email' : 'Create account'}
            </button>
          </form>
        </div>

        {mode === 'signup' && (
          <p className="text-center text-xs text-gray-400 mt-4">
            After signing up you will need to confirm your email before logging in
          </p>
        )}
      </div>
    </div>
  )
}
