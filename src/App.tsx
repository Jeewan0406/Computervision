import { lazy, Suspense, useEffect } from 'react';
import { useUI } from './lib/ui';
import { useSettings } from './lib/settings';
import { useData } from './lib/data';
import { APP_VERSION } from './lib/changelog';
import { Sidebar } from './components/Shell';
import { Modals } from './components/Modals';
import { ChatView } from './views/ChatView';
import { LogoMark } from './components/Logo';

// Heavier views load on first visit.
const AgentView = lazy(() => import('./views/AgentView').then((m) => ({ default: m.AgentView })));
const CompareView = lazy(() => import('./views/CompareView').then((m) => ({ default: m.CompareView })));
const TeamView = lazy(() => import('./views/TeamView').then((m) => ({ default: m.TeamView })));
const CodeView = lazy(() => import('./views/CodeView').then((m) => ({ default: m.CodeView })));
const KeysView = lazy(() => import('./views/KeysView').then((m) => ({ default: m.KeysView })));
const LogsView = lazy(() => import('./views/LogsView').then((m) => ({ default: m.LogsView })));

function useTheme() {
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const t = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = t;
      document.documentElement.dataset.accent = accent;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#140d0b' : '#fbf6ee');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, accent]);
}

function Loading() {
  return (
    <div className="view-loading">
      <LogoMark size={44} className="breathe" />
    </div>
  );
}

export default function App() {
  useTheme();
  const view = useUI((s) => s.view);
  const hydrated = useData((s) => s.hydrated);
  const seen = useSettings((s) => s.seenVersion);
  const openModal = useUI((s) => s.openModal);

  useEffect(() => {
    if (hydrated && seen && seen !== APP_VERSION) openModal('whatsnew');
    if (hydrated && seen !== APP_VERSION) useSettings.getState().set({ seenVersion: APP_VERSION });
  }, [hydrated, seen, openModal]);

  return (
    <div className="app">
      <div className="bg-glow" aria-hidden="true" />
      <Sidebar />
      <main className="main">
        {!hydrated ? (
          <Loading />
        ) : (
          <Suspense fallback={<Loading />}>
            {view === 'chat' && <ChatView />}
            {view === 'agent' && <AgentView />}
            {view === 'compare' && <CompareView />}
            {view === 'team' && <TeamView />}
            {view === 'code' && <CodeView />}
            {view === 'keys' && <KeysView />}
            {view === 'logs' && <LogsView />}
          </Suspense>
        )}
      </main>
      <Modals />
    </div>
  );
}
