'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { fetchJson, ApiError, isRecord } from '../../lib/api';

type AssistantResponse = {
  reply: string;
  data?: unknown;
};

type Message =
  | { role: 'user'; text: string }
  | { role: 'assistant'; reply: string; data?: unknown }
  | { role: 'error'; text: string; unauthorized?: boolean };

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, pending]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    setInput('');
    setMessages((current) => [...current, { role: 'user', text }]);
    setPending(true);
    try {
      const result = await fetchJson<AssistantResponse>('/api/assistant', {
        method: 'POST',
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ message: text })
      });
      setMessages((current) => [...current, { role: 'assistant', reply: result.reply, data: result.data }]);
    } catch (cause) {
      const unauthorized = cause instanceof ApiError && cause.status === 401;
      const message = cause instanceof DOMException && cause.name === 'TimeoutError'
        ? 'The assistant took too long to respond. Try again.'
        : cause instanceof Error ? cause.message : 'The assistant could not answer.';
      setMessages((current) => [...current, { role: 'error', text: message, unauthorized }]);
    } finally {
      setPending(false);
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
          <div><h2 id="assistant-title">CHAT WITH ATRIUM</h2><p className="muted">Try “show upcoming sessions” or “how many credits do I have?”</p></div>
        </div>
        <div className="assistant-chat" aria-live="polite">
          {messages.length === 0 && !pending && <p className="state-line">Start the conversation — ask about sessions, a booking, or your balance.</p>}
          {messages.map((message, index) => (
            <div key={index} className={`chat-row chat-${message.role}`}>
              {message.role === 'user' && <div className="chat-bubble chat-user-bubble"><p>{message.text}</p></div>}
              {message.role === 'assistant' && (
                <div className="chat-bubble chat-assistant-bubble">
                  <p>{message.reply}</p>
                  <DataSummary data={message.data} />
                </div>
              )}
              {message.role === 'error' && (
                <div className="chat-bubble chat-error-bubble" role="alert">
                  <p>{message.text}</p>
                  {message.unauthorized && <p className="assistant-signin"><Link href="/login">Sign in</Link> to unlock your credits, bookings, and coaching actions.</p>}
                </div>
              )}
            </div>
          ))}
          {pending && <div className="chat-row chat-assistant"><div className="chat-bubble chat-assistant-bubble"><p className="assistant-thinking">CHECKING YOUR REQUEST...</p></div></div>}
          <div ref={bottomRef} />
        </div>
        <form className="assistant-form" onSubmit={submit}>
          <label><span>Your message</span><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask Atrium..." rows={3} disabled={pending} /></label>
          <button type="submit" className={pending ? 'is-loading' : ''} disabled={pending || !input.trim()}>{pending ? 'Thinking...' : 'Send'}</button>
        </form>
      </section>
    </main>
  );
}
