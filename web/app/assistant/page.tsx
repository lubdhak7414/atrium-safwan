'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { fetchJson, ApiError, isRecord } from '../../lib/api';
import { formatCentreDate, formatCentreShortDate, formatCentreTime } from '../../lib/time';
import { useCurrentUser } from '../../components/CurrentUserProvider';

type AssistantResponse = {
  reply: string;
  data?: unknown;
  suggestions?: string[];
};

type Message =
  | { role: 'user'; text: string }
  | { role: 'assistant'; reply: string; data?: unknown; suggestions?: string[] }
  | { role: 'error'; text: string; unauthorized?: boolean; suggestions?: string[] };

const INTERNAL_KEYS = new Set(['person_id', 'room_id', 'coach_id']);

type FlatPair = { label: string; value: unknown };

function arrayCellText(value: unknown[]): string {
  return value
    .map((item) => {
      if (isRecord(item)) {
        return Object.entries(item)
          .filter(([key, inner]) => !INTERNAL_KEYS.has(key) && inner !== null && typeof inner !== 'object')
          .map(([key, inner]) => `${key.replace(/_/g, ' ')}: ${String(inner)}`)
          .join(', ');
      }
      return String(item);
    })
    .join(' · ');
}

function flattenRow(row: Record<string, unknown>, prefix = ''): FlatPair[] {
  const out: FlatPair[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (INTERNAL_KEYS.has(key)) continue;
    const label = prefix ? `${prefix} ${key}` : key;
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      out.push({ label, value: arrayCellText(value) });
    } else if (typeof value === 'object') {
      out.push(...flattenRow(value as Record<string, unknown>, label));
    } else {
      out.push({ label, value });
    }
  }
  return out;
}

function formatCellText(label: string, value: unknown): string {
  const text = String(value ?? '—');
  if (label.endsWith('starts_at') || label.endsWith('ends_at')) return `${formatCentreDate(text)} ${formatCentreTime(text)}`;
  return text;
}

function tableColumns(rows: FlatPair[][]): string[] {
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const row of rows) {
    for (const { label } of row) {
      if (!seen.has(label)) {
        seen.add(label);
        columns.push(label);
      }
    }
  }
  return columns;
}

function RecordPairs({ record }: { record: Record<string, unknown> }) {
  const pairs = flattenRow(record);
  if (pairs.length === 0) return null;
  return (
    <dl className="assistant-data-pairs">
      {pairs.map(({ label, value }, index) => (
        <div key={index}><dt>{label.replace(/_/g, ' ')}</dt><dd>{formatCellText(label, value)}</dd></div>
      ))}
    </dl>
  );
}

function Table({ rows }: { rows: Record<string, unknown>[] }) {
  const flat = rows.map((row) => flattenRow(row));
  const columns = tableColumns(flat);
  if (columns.length === 0) return null;
  return (
    <div className="assistant-table-wrap">
      <table className="assistant-table">
        <thead>
          <tr>{columns.map((column) => <th key={column} scope="col">{column.replace(/_/g, ' ')}</th>)}</tr>
        </thead>
        <tbody>
          {flat.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => {
                const pair = row.find((cell) => cell.label === column);
                return <td key={column}>{pair ? formatCellText(column, pair.value) : '—'}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sessionName(row: Record<string, unknown>): string {
  const discipline = String(row.discipline ?? 'Session');
  const type = typeof row.session_type === 'string' && row.session_type ? row.session_type : '';
  return type ? `${discipline} · ${type}` : discipline;
}

function sessionSchedule(row: Record<string, unknown>): string {
  const start = row.starts_at;
  const end = row.ends_at;
  if (typeof start !== 'string' || !start) return '—';
  const date = formatCentreShortDate(start);
  if (typeof end !== 'string' || !end) return `${date} · ${formatCentreTime(start)}`;
  const range = `${date} · ${formatCentreTime(start)}–${formatCentreTime(end)}`;
  const endDate = formatCentreShortDate(end);
  return endDate === date ? range : `${range} (ends ${endDate})`;
}

function sessionDetails(row: Record<string, unknown>): string {
  const parts: string[] = [];
  if (row.visibility === 'busy') {
    if (typeof row.room_name === 'string' && row.room_name) parts.push(row.room_name);
    parts.push('busy');
    return parts.join(' · ') || 'Busy';
  }
  if (typeof row.room_name === 'string' && row.room_name) parts.push(row.room_name);
  if (typeof row.places_remaining === 'number') parts.push(`${row.places_remaining} spots`);
  if (typeof row.seat_fee_credits === 'number') parts.push(`${row.seat_fee_credits} credits`);
  if (isRecord(row.my_enrolment)) {
    const status = String(row.my_enrolment.status ?? 'active');
    if (typeof row.my_enrolment.credits_charged === 'number') parts.push(`your booking: ${status} · ${row.my_enrolment.credits_charged} credits`);
    else parts.push(`your booking: ${status}`);
  }
  if (row.is_own_session === true) parts.push('your session');
  if (typeof row.coach_name === 'string' && row.coach_name) {
    if (typeof row.room_fee_credits === 'number') parts.push(`coach ${row.coach_name} · room fee ${row.room_fee_credits}`);
    else parts.push(`coach ${row.coach_name}`);
  }
  return parts.join(' · ') || '—';
}

function SessionsTable({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <div className="assistant-table-wrap">
      <table className="assistant-table">
        <thead>
          <tr><th scope="col">ID</th><th scope="col">Session</th><th scope="col">Date &amp; time</th><th scope="col">Details</th></tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td>{row.id != null ? String(row.id) : '—'}</td>
              <td>{sessionName(row)}</td>
              <td>{sessionSchedule(row)}</td>
              <td>{sessionDetails(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataSummary({ data }: { data: unknown }) {
  if (!isRecord(data)) return null;
  return (
    <>
      {Object.entries(data).map(([key, value]) => {
        if (Array.isArray(value)) {
          const records = value.filter(isRecord);
          return (
            <section key={key}>
              <h3 className="assistant-data-heading">{key.replace(/_/g, ' ')}</h3>
              {value.length === 0 ? (
                <p className="muted">No records to show.</p>
              ) : records.length === value.length ? (
                key === 'sessions' ? <SessionsTable rows={records} /> : <Table rows={records} />
              ) : (
                <div className="assistant-data">
                  {value.map((row, index) => (
                    <div className="assistant-data-row" key={index}>{isRecord(row) ? <RecordPairs record={row} /> : <p>{String(row)}</p>}</div>
                  ))}
                </div>
              )}
            </section>
          );
        }
        if (isRecord(value)) {
          return <div className="assistant-data-row" key={key}><RecordPairs record={value} /></div>;
        }
        return null;
      })}
    </>
  );
}

function SuggestionPills({ suggestions, onPick, disabled }: { suggestions: string[]; onPick: (text: string) => void; disabled: boolean }) {
  if (suggestions.length === 0) return null;
  return (
    <div className="assistant-pills">
      {suggestions.map((suggestion) => (
        <button key={suggestion} type="button" className="assistant-pill" disabled={disabled} onClick={() => onPick(suggestion)}>{suggestion}</button>
      ))}
    </div>
  );
}

export default function AssistantPage() {
  const { user } = useCurrentUser();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    const chat = chatRef.current;
    if (!chat) return;
    chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
  }, [messages, pending]);

  const initialSuggestions = user
    ? ['show all upcoming sessions', 'show fitness sessions', 'how many credits do I have?', 'my bookings']
    : ['show all upcoming sessions', 'show fitness sessions'];

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pendingRef.current) return;
    pendingRef.current = true;
    setInput('');
    setMessages((current) => [...current, { role: 'user', text: trimmed }]);
    setPending(true);
    try {
      const result = await fetchJson<AssistantResponse>('/api/assistant', {
        method: 'POST',
        signal: AbortSignal.timeout(75000),
        body: JSON.stringify({ message: trimmed })
      });
      setMessages((current) => [...current, { role: 'assistant', reply: result.reply, data: result.data, suggestions: result.suggestions }]);
    } catch (cause) {
      const unauthorized = cause instanceof ApiError && cause.status === 401;
      const suggestions = cause instanceof ApiError ? cause.suggestions : undefined;
      const message = cause instanceof DOMException && cause.name === 'TimeoutError'
        ? 'The assistant took too long to respond. If you were booking or cancelling something, check your bookings before trying again.'
        : cause instanceof Error ? cause.message : 'The assistant could not answer.';
      setMessages((current) => [...current, { role: 'error', text: message, unauthorized, suggestions }]);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await send(input);
  }

  return (
    <main className="page-shell assistant-shell">
      <section className="assistant-intro">
        <h1>Ask about sessions, bookings, or your balance.</h1>
      </section>
      <section className="assistant-panel" aria-labelledby="assistant-title">
        <div className="card-heading">
          <div><h2 id="assistant-title">CHAT WITH ATRIUM</h2><p className="muted">Try “show all upcoming sessions” or “how many credits do I have?”</p></div>
        </div>
        <div className="assistant-chat" aria-live="polite" aria-relevant="additions" ref={chatRef}>
          {messages.length === 0 && !pending && (
            <>
              <p className="state-line">Start the conversation — ask about sessions, a booking, or your balance.</p>
              <SuggestionPills suggestions={initialSuggestions} onPick={send} disabled={pending} />
            </>
          )}
          {messages.map((message, index) => (
            <div key={index} className={`chat-row chat-${message.role}`}>
              {message.role === 'user' && <div className="chat-bubble chat-user-bubble"><p>{message.text}</p></div>}
              {message.role === 'assistant' && (
                <div className="chat-bubble chat-assistant-bubble">
                  <p>{message.reply}</p>
                  <DataSummary data={message.data} />
                  <SuggestionPills suggestions={message.suggestions ?? []} onPick={send} disabled={pending} />
                </div>
              )}
              {message.role === 'error' && (
                <div className="chat-bubble chat-error-bubble">
                  <p>{message.text}</p>
                  {message.unauthorized && <p className="assistant-signin"><Link href="/login">Sign in</Link></p>}
                  <SuggestionPills suggestions={message.suggestions ?? []} onPick={send} disabled={pending} />
                </div>
              )}
            </div>
          ))}
          {pending && <div className="chat-row chat-assistant"><div className="chat-bubble chat-assistant-bubble"><p className="assistant-thinking">CHECKING YOUR REQUEST...</p></div></div>}
        </div>
        <form className="assistant-form" onSubmit={submit}>
          <label><span>Your message</span><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask Atrium..." rows={3} disabled={pending} /></label>
          <button type="submit" className={pending ? 'is-loading' : ''} disabled={pending || !input.trim()}>{pending ? 'THINKING...' : 'SEND'}</button>
        </form>
      </section>
    </main>
  );
}
