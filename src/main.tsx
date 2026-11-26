import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './styles.css';
import { applyTheme, getTheme } from './theme';
import { OfflineBar, registerSW } from './pwa';

// Тему применяем до первой отрисовки, чтобы не мигало
applyTheme(getTheme());

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary whole>
    <App />
    <OfflineBar />
  </ErrorBoundary>,
);

registerSW();
