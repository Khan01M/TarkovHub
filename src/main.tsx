import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { applyTheme, getTheme } from './theme';

// Тему применяем до первой отрисовки, чтобы не мигало
applyTheme(getTheme());

createRoot(document.getElementById('root')!).render(<App />);
