import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import 'pdfjs-dist/web/pdf_viewer.css'
import './styles.css'
import './skins.css'
import './layouts.css'
import './compact.css'
import { configureReaderHost } from './host'
import { createDesktopHost } from './desktop-host'

configureReaderHost(createDesktopHost())

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary application>
    <App />
  </ErrorBoundary>,
)
