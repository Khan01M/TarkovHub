import { Component, ErrorInfo, ReactNode } from 'react';

// Ловит ошибки рендера, чтобы вместо белого экрана был понятный экран с выходом.
// В App.tsx оборачивает текущую страницу (шапка и навигация остаются рабочими),
// в main.tsx — всё приложение на случай падения самой оболочки.

type Props = { children: ReactNode; whole?: boolean };
type St = { error: Error | null };

/** Удаляет только кэш данных tarkov.dev (ключи `data:*`). Прогресс и настройки не трогаем. */
function clearDataCache() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('data:')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* хранилище недоступно — просто перезагрузимся */ }
  location.reload();
}

export default class ErrorBoundary extends Component<Props, St> {
  state: St = { error: null };

  static getDerivedStateFromError(error: unknown): St {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Ошибка отрисовки страницы:', error, info.componentStack);
  }

  // Переход по ссылке внутри того же раздела (например, другой босс) тоже сбрасывает ошибку
  componentDidMount() { addEventListener('hashchange', this.onHash); }
  componentWillUnmount() { removeEventListener('hashchange', this.onHash); }
  onHash = () => { if (this.state.error) this.reset(); };

  reset = () => this.setState({ error: null });

  goHome = () => {
    if (location.hash !== '#/home') location.hash = '#/home';
    this.reset();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className={this.props.whole ? 'content' : undefined}>
        <h1>Что-то сломалось {this.props.whole ? 'в приложении' : 'на этой странице'}</h1>
        <div className="alert">
          <div>Можно попробовать ещё раз, вернуться на главную или сбросить сохранённые данные справочника — прогресс и настройки останутся.</div>
          <div className="muted small" style={{ wordBreak: 'break-word', marginTop: 6 }}>{error.message || String(error)}</div>
          <button className="btn small" onClick={this.reset}>Попробовать снова</button>
          <button className="btn small ghost" onClick={this.goHome}>На главную</button>
          <button className="btn small ghost" onClick={clearDataCache}>Сбросить кэш данных</button>
        </div>
      </section>
    );
  }
}
