import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { SchedulingRule } from '@/types'

export async function GET() {
  try {
    const supabase = await createClient()

    const { data: rules, error } = await supabase
      .from('scheduling_rules')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error fetching rules:', error)
      return NextResponse.json({ error: 'Failed to fetch rules' }, { status: 500 })
    }

    return NextResponse.json(rules)
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()

    const { name, display_name, description, severity, is_enabled = true, parameters = {} } = body

    if (!name || !display_name || !description || !severity) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (!['error', 'warning'].includes(severity)) {
      return NextResponse.json({ error: 'Invalid severity' }, { status: 400 })
    }

    const { data: rule, error } = await supabase
      .from('scheduling_rules')
      .insert({
        name,
        display_name,
        description,
        severity,
        is_enabled,
        parameters
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating rule:', error)
      return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 })
    }

    return NextResponse.json(rule, { status: 201 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}