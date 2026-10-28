import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<span hidden aria-hidden="true" />} />
          <Route path="login" element={<span hidden aria-hidden="true" />} />
          <Route path="audit/text" element={<span hidden aria-hidden="true" />} />
          <Route path="audit/image" element={<span hidden aria-hidden="true" />} />
          <Route path="rulebook" element={<span hidden aria-hidden="true" />} />
          <Route path="submissions" element={<span hidden aria-hidden="true" />} />
          <Route path="submissions/:submissionId/edit" element={<span hidden aria-hidden="true" />} />
          <Route path="review" element={<span hidden aria-hidden="true" />} />
          <Route path="*" element={<span hidden aria-hidden="true" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
