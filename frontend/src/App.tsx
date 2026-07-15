import { useState } from 'react'
import './App.css'
import ChatPanel from './components/ChatPanel'
import DashboardPanel from './components/DashboardPanel'
import DocumentsPanel from './components/DocumentsPanel'
import MatchAnalysisPanel from './components/MatchAnalysisPanel'

type Workspace = 'documents' | 'ask' | 'match' | 'dashboard'

const navigation: Array<{ id: Workspace; label: string; description: string }> = [
  { id: 'documents', label: 'Documents', description: 'Ingest and index' },
  { id: 'ask', label: 'Ask', description: 'Grounded chat' },
  { id: 'match', label: 'Match', description: 'Resume alignment' },
  { id: 'dashboard', label: 'Dashboard', description: 'Operational summary' },
]

function App() {
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>('documents')
  const activeItem = navigation.find((item) => item.id === activeWorkspace) ?? navigation[0]

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">Skip to workspace content</a>
      <header className="app-header">
        <div className="brand"><span className="brand-mark" aria-hidden="true">R</span><div><strong>ResumeOps</strong><span>Evidence workspace</span></div></div>
        <p className="header-context"><span>Operations workspace</span><strong>{activeItem.label}</strong></p>
      </header>
      <div className="app-frame">
        <nav className="workspace-nav" aria-label="Primary workspace navigation">
          <p className="nav-label">Workspace</p>
          {navigation.map((item, index) => (
            <button key={item.id} type="button" className={activeWorkspace === item.id ? 'active' : ''} aria-current={activeWorkspace === item.id ? 'page' : undefined} onClick={() => setActiveWorkspace(item.id)}>
              <span className="nav-number" aria-hidden="true">0{index + 1}</span><span><strong>{item.label}</strong><small>{item.description}</small></span>
            </button>
          ))}
          <div className="nav-note"><strong>Built for traceability</strong><span>Every answer is linked to indexed source material.</span></div>
        </nav>
        <main id="workspace-content" className="workspace-content" tabIndex={-1}>
          {activeWorkspace === 'documents' && <DocumentsPanel />}
          {activeWorkspace === 'ask' && <ChatPanel />}
          {activeWorkspace === 'match' && <MatchAnalysisPanel />}
          {activeWorkspace === 'dashboard' && <DashboardPanel />}
        </main>
      </div>
    </div>
  )
}

export default App
