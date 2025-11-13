'use client'

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { loginRequest, LoginResponse, registerRequest, RegisterPayload } from './api-client'

type AuthState = {
  token: string | null
  user: LoginResponse['user'] | null
}

type AuthContextValue = AuthState & {
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (payload: RegisterPayload) => Promise<void>
  logout: () => void
}

const STORAGE_KEY = 'warehouse-auth'

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ token: null, user: null })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored =
      typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as AuthState
        setState(parsed)
      } catch {
        window.localStorage.removeItem(STORAGE_KEY)
      }
    }
    setLoading(false)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const response = await loginRequest(email, password)
    const payload: AuthState = { token: response.token, user: response.user }
    setState(payload)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [])

  const register = useCallback(async (payload: RegisterPayload) => {
    const response = await registerRequest(payload)
    const statePayload: AuthState = { token: response.token, user: response.user }
    setState(statePayload)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(statePayload))
  }, [])

  const logout = useCallback(() => {
    setState({ token: null, user: null })
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  return (
    <AuthContext.Provider value={{ ...state, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
