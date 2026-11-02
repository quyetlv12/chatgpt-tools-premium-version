import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'
import { FeedbackProvider } from '@/components/FeedbackProvider'

const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
createRoot(document.getElementById('root')).render(
  <StrictMode><QueryClientProvider client={queryClient}><FeedbackProvider><App /></FeedbackProvider></QueryClientProvider></StrictMode>,
)
