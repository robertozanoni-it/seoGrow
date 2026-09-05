import './gdprSeoMigration';
import './remediationVerificationMigration';
import './remediationIntegrity';
import './locationEvents';
import './liveRollbackRouter';
import './wordpressSeoRuntimePatch';
import './remediationUiOrderPatch';
import './remediationCompletionUxPatch';
import './seoResponseIntegrity';
import './remediationReportUx';
import './backupImportGuard';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import GuidedUxLayer from './GuidedUxLayer';
import ProblemsNavBridge from './ProblemsNavBridge';
import ProblemsWorkspace from './ProblemsWorkspace';
import AuditWorkspace from './AuditWorkspace';
import RemediationHost from './RemediationHost';
import CorrectionsWorkspace from './CorrectionsWorkspace';
import WordPressConnectionControl from './WordPressConnectionControl';
import WordPressLiveRemediationControlV2 from './WordPressLiveRemediationControlV2';
import WordPressConnectorControl from './WordPressConnectorControl';
import './styles.css';

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <h1>seoGrow AI non riesce a mostrare questa schermata</h1>
        <p>I dati locali non sono stati eliminati. Ricarica l’app; se il problema continua, esporta o ripristina un backup.</p>
        <details><summary>Dettaglio tecnico</summary><pre>{String(this.state.error.message || this.state.error)}</pre></details>
        <button onClick={() => window.location.reload()}>Ricarica l’app</button>
      </main>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
      <GuidedUxLayer />
      <ProblemsNavBridge />
      <ProblemsWorkspace />
      <AuditWorkspace />
      <RemediationHost />
      <WordPressConnectionControl />
      <WordPressLiveRemediationControlV2 />
      <WordPressConnectorControl />
      <CorrectionsWorkspace />
    </AppErrorBoundary>
  </React.StrictMode>,
);
