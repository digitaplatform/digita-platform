import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Rendered instead of the children when a descendant throws during render. */
  fallback: (error: Error) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Generic render error boundary. Used app-wide (a render throw becomes a visible
 * screen, not a blank page) and per-plugin (one misbehaving runtime-loaded plugin
 * shows a local error instead of taking down the whole shell — important for the
 * shared-singleton plugin model where a misconfigured plugin can throw).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error('[digita] render error caught by boundary:', error);
  }

  override render(): ReactNode {
    if (this.state.error) return this.props.fallback(this.state.error);
    return this.props.children;
  }
}
