'use client';

import { useState } from 'react';
import Link from 'next/link';
import { fetchJson, ApiError, isRecord } from '../../lib/api';

type AssistantResponse = {
  reply: string;
  data?: unknown;
};

function ScalarPairs({ value }: { value: unknown }) {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value).filter(([, item]) => typeof item !== 'object');
  if (entries.length === 0) return null;
  return (
    <dl className="assistant-data-pairs">
      {entries.map(([key, item]) => (
        <div key={key}><dt>{key}</dt><dd>{String(item)}</dd></div>
      ))}
    </dl>
  );
}

function SummaryRows({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="muted">No records to show.</p>;
    return (
      <div className="assistant-data">
        {value.map((row, index) => (
          <div className="assistant-data-row" key={index}>
            {isRecord(row) ? <ScalarPairs value={row} /> : <p>{String(row)}</p>}
          </div>
        ))}
      </div>
    );
  }
  if (isRecord(value)) return <ScalarPairs value={value} />;
  return <p className="muted">{String(value)}</p>;
}

function DataSummary({ data }: { data: unknown }) {
  if (!isRecord(data)) return null;
  const sections = Object.entries(data).filter(([, value]) => typeof value === 'object');
  return (
    <>
      {Object.entries(data).filter(([, value]) => typeof value !== 'object').map(([key, value]) => (
        <p key={key}><span className="assistant-data-key">{key}:</span> {String(value)}</p>
      ))}
      {sections.map(([key, value]) => (
        <section key={key}>
          <h3 className="assistant-data-heading">{key}</h3>
          <SummaryRows value={value} />
        </section>
      ))}
    </>
  );
}

export default function AssistantPage() {
  const [message, setMessage] = useState('');
  const [answer, setAnswer] = useState<AssistantResponse | null>(null);
  const [state, setState] = useState<'empty' | 'loading' | 'ready' | 'error'>('empty');
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim() || state === 'loading') return;
    setState('loading');
    setError('');
    setUnauthorized(false);
    try {
      const result = await fetchJson<AssistantResponse>('/api/assistant', {
        method: 'POST',
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ message })
      });
      setAnswer(result);
      setState('ready');
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'TimeoutError') {
        setError('The assistant took too long to respond. Try again.');
      } else {
        setUnauthorized(cause instanceof ApiError && cause.status === 401);
        setError(cause instanceof Error ? cause.message : 'The assistant could not answer.');
      }
      setState('error');
    }
  }

  return (
    <main className="page-shell assistant-shell">
      <section className="assistant-intro">
        <p className="eyebrow">ATRIUM ASSISTANT</p>
        <h1>Ask about sessions, bookings, or your balance.</h1>
        <p className="muted">The assistant only shows information and actions available to the account in your session.</p>
      </section>
      <section className="assistant-panel" aria-labelledby="assistant-title">
        <div className="card-heading">
          <div><h2 id="assistant-title">WHAT DO YOU NEED?</h2><p className="muted">Try “show upcoming sessions” or “how many credits do I have?”</p></div>
        </div>
        <form className="assistant-form" onSubmit={submit}>
          <label><span>Your request</span><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask Atrium..." rows={4} disabled={state === 'loading'} /></label>
          <button type="submit" className={state === 'loading' ? 'is-loading' : ''} disabled={state === 'loading' || !message.trim()}>{state === 'loading' ? 'Thinking...' : 'Ask assistant'}</button>
        </form>
        <div className="assistant-status" aria-live="polite">
          {state === 'empty' && <p className="state-line">Your answer will appear here.</p>}
          {state === 'loading' && <p className="state-line">CHECKING YOUR REQUEST...</p>}
          {state === 'error' && (
            <div className="error-line" role="alert">
              <p>{error}</p>
              {unauthorized && <p className="assistant-signin"><Link href="/login">Sign in</Link> to unlock your credits, bookings, and coaching actions.</p>}
            </div>
          )}
          {state === 'ready' && answer && (
            <div className="assistant-answer">
              <p>{answer.reply}</p>
              <DataSummary data={answer.data} />
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
