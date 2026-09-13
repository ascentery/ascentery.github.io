import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import Ascentery from './Ascentery.jsx'
import { ErrorBoundary } from './ErrorBoundary.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Ascentery />
    </ErrorBoundary>
  </React.StrictMode>,
)
