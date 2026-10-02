import { useState, type FormEvent } from 'react';

export function App() {
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    // Basic form shape only. Independent server validation belongs to Phase 1.
    if (!/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/?$/.test(repositoryUrl.trim())) {
      setError('Enter a public repository URL such as https://github.com/owner/repo.');
      return;
    }
    setMessage('URL entered. Repository scanning arrives in Phase 1; no repository request was sent.');
  }

  return (
    <main>
      <p className="eyebrow">DOCSCOUT · PHASE 0</p>
      <h1>A starting point for your next contribution.</h1>
      <p className="intro">DocScout will help you find evidence-backed documentation tasks and labeled issues in public GitHub repositories.</p>
      <form onSubmit={submit} noValidate>
        <label htmlFor="repository">GitHub repository URL</label>
        <p id="url-help">Use https://github.com/owner/repo. No login or credentials required.</p>
        <div className="form-row">
          <input id="repository" type="url" value={repositoryUrl}
            onChange={(event) => { setRepositoryUrl(event.target.value); setError(''); setMessage(''); }}
            placeholder="https://github.com/owner/repo" autoComplete="url"
            spellCheck={false} required aria-invalid={Boolean(error)}
            aria-describedby={error ? 'url-help url-error' : 'url-help'} />
          <button type="submit">Analyze repository</button>
        </div>
        {error && <p id="url-error" role="alert" className="error">{error}</p>}
        <p role="status" aria-live="polite">{message}</p>
      </form>
      <aside>
        <h2>Setup preview</h2>
        <p>The local form and server are ready for testing. Repository scanning is planned for Phase 1.</p>
        <p>AI is disabled. This preview sends no repository data to GitHub or an AI provider and uses no analytics.</p>
      </aside>
    </main>
  );
}
