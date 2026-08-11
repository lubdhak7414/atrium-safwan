import { z } from 'zod';
import { Caller, getSessionForCaller, listPeopleForCaller, listSessionsForCaller } from './permissions';
import { query } from './db';
import { DomainError, cancelBooking, cancelSession, changeBooking, checkIn, enrolAnonymous, enrolSession, reassignSession, rescheduleSession } from './booking';

export const assistantRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  tool: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional()
}).strict();

type ToolName = 'search_sessions' | 'book_session' | 'change_booking' | 'cancel_booking' | 'my_bookings' | 'my_credits' | 'coach_session_detail' | 'cancel_session' | 'reschedule_session' | 'reassign_session' | 'check_in' | 'admin_people' | 'admin_sessions';
type ToolCall = { name: ToolName; input: Record<string, unknown> };
const toolNames = new Set<ToolName>(['search_sessions', 'book_session', 'change_booking', 'cancel_booking', 'my_bookings', 'my_credits', 'coach_session_detail', 'cancel_session', 'reschedule_session', 'reassign_session', 'check_in', 'admin_people', 'admin_sessions']);

function numberInput(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== 'string' && typeof value !== 'number') throw new DomainError(400, `${key} must be a positive integer`);
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new DomainError(400, `${key} must be a positive integer`);
  return number;
}

function callerLabel(caller: Caller | undefined): string {
  return caller ? `You are signed in as a ${caller.kind}.` : 'You are browsing Atrium as a visitor.';
}

function stubCall(message: string, requestedTool?: string, requestedInput: Record<string, unknown> = {}): ToolCall | null {
  if (requestedTool) return { name: requestedTool as ToolName, input: requestedInput };
  const lower = message.toLowerCase();
  const session = lower.match(/(?:session|class)\s+#?(\d+)/);
  const sessionId = session ? Number(session[1]) : undefined;
  const booking = lower.match(/(?:booking|enrolment)\s+#?(\d+)/);
  const bookingId = booking ? Number(booking[1]) : undefined;
  const destination = lower.match(/to\s+(?:session|class)\s+#?(\d+)/);
  const destinationId = destination ? Number(destination[1]) : undefined;

  if (/(?:cancel|remove)/.test(lower)) {
    if (/(?:booking|enrolment)/.test(lower)) {
      return bookingId ? { name: 'cancel_booking', input: { enrolment_id: bookingId } } : null;
    }
    if (sessionId) return { name: 'cancel_session', input: { session_id: sessionId } };
    return null;
  }
  if (/(?:change|move|switch)/.test(lower)) {
    if (bookingId && destinationId) {
      return { name: 'change_booking', input: { enrolment_id: bookingId, destination_session_id: destinationId } };
    }
    return null;
  }
  if (/(?:book|reserve|enrol)/.test(lower) && sessionId) {
    const email = lower.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0];
    return { name: 'book_session', input: { session_id: sessionId, email, full_name: message.match(/name\s*[:=]\s*([^,]+)/i)?.[1]?.trim() } };
  }
  if (/(?:credit|balance|how much do i have)/.test(lower)) return { name: 'my_credits', input: {} };
  if (/(?:my bookings|my sessions|what have i booked)/.test(lower)) return { name: 'my_bookings', input: {} };
  if (/(?:find|search|upcoming|available|catalogue|sessions)/.test(lower)) return { name: 'search_sessions', input: {} };
  return null;
}

async function ollamaCall(message: string): Promise<ToolCall | null> {
  try {
    const baseUrl = process.env.MODEL_BASE_URL || 'http://localhost:11434';
    const model = process.env.MODEL_NAME || 'qwen32k:latest';
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: 'Return only JSON with keys tool and input. Choose one supported Atrium assistant tool or use null. Do not answer the user.' },
          { role: 'user', content: message }
        ]
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`model provider returned ${response.status}`);
    const payload = await response.json() as { message?: { content?: string } };
    const parsed = JSON.parse(payload.message?.content || '{}') as { tool?: unknown; input?: Record<string, unknown> };
    if (typeof parsed.tool !== 'string' || !parsed.tool) return null;
    return { name: parsed.tool as ToolName, input: parsed.input ?? {} };
  } catch (error) {
    console.error('assistant model provider failed; falling back to the stub', error);
    return null;
  }
}

function assertAllowed(name: ToolName, caller: Caller | undefined): void {
  if (!toolNames.has(name)) throw new DomainError(400, 'that assistant action is not supported');
  const anonymousAllowed: ToolName[] = ['search_sessions', 'book_session'];
  if (!caller && !anonymousAllowed.includes(name)) throw new DomainError(401, 'sign in to use that assistant action');
  if (name.startsWith('admin_') && caller?.kind !== 'admin') throw new DomainError(403, 'that assistant action is only available to administrators');
  if (name === 'coach_session_detail' && caller?.kind !== 'coach' && caller?.kind !== 'admin') throw new DomainError(403, 'that assistant action is only available to coaches and administrators');
  if (['cancel_session', 'reschedule_session', 'check_in'].includes(name) && caller?.kind !== 'coach' && caller?.kind !== 'admin') throw new DomainError(403, 'that assistant action is only available to coaches and administrators');
  if (name === 'reassign_session' && caller?.kind !== 'admin') throw new DomainError(403, 'that assistant action is only available to administrators');
}

async function executeTool(call: ToolCall, caller: Caller | undefined): Promise<Record<string, unknown>> {
  assertAllowed(call.name, caller);
  const input = call.input;
  switch (call.name) {
    case 'search_sessions': {
      const from = caller?.kind === 'coach' ? new Date(0).toISOString() : new Date().toISOString();
      const to = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const sessions = await listSessionsForCaller(caller, from, to, undefined, false);
      if (caller?.kind !== 'coach') return { sessions };
      const ownSessions = sessions.filter((session) => session.is_own_session === true);
      const details = await Promise.all(ownSessions.map(async (session) => ({
        id: session.id,
        detail: await getSessionForCaller(Number(session.id), caller)
      })));
      return { sessions, own_session_details: details };
    }
    case 'book_session': {
      const sessionId = numberInput(input, 'session_id');
      if (caller) return { booking: await enrolSession(sessionId, caller) };
      const email = String(input.email || '');
      const fullName = String(input.full_name || '');
      return { booking: await enrolAnonymous({ sessionId, email, fullName }) };
    }
    case 'my_credits':
      return { credits: caller!.credits, kind: caller!.kind };
    case 'my_bookings': {
      const rows = await query(
        `select e.id, e.session_id, e.status, e.credits_charged, e.credits_refunded,
                s.discipline, s.session_type, s.starts_at, s.ends_at
           from enrolment e join session s on s.id = e.session_id
          where e.person_id = $1 order by s.starts_at`,
        [caller!.id]
      );
      return { bookings: rows };
    }
    case 'coach_session_detail':
      return { session: await getSessionForCaller(numberInput(input, 'session_id'), caller!) };
    case 'cancel_booking': return { result: await cancelBooking(numberInput(input, 'enrolment_id'), caller!) };
    case 'change_booking': return { result: await changeBooking(numberInput(input, 'enrolment_id'), numberInput(input, 'destination_session_id'), caller!) };
    case 'cancel_session': return { result: await cancelSession(numberInput(input, 'session_id'), caller!) };
    case 'reschedule_session':
      return { result: await rescheduleSession(numberInput(input, 'session_id'), { roomId: numberInput(input, 'room_id'), localDate: String(input.local_date), localStartTime: String(input.local_start_time), localEndTime: String(input.local_end_time) }, caller!) };
    case 'reassign_session': return { result: await reassignSession(numberInput(input, 'session_id'), numberInput(input, 'coach_id'), caller!) };
    case 'check_in': return { result: await checkIn(numberInput(input, 'session_id'), numberInput(input, 'enrolment_id'), caller!) };
    case 'admin_people': return { people: await listPeopleForCaller(caller!, typeof input.kind === 'string' ? input.kind as Caller['kind'] : undefined) };
    case 'admin_sessions': return { sessions: await listSessionsForCaller(caller!, new Date().toISOString(), undefined, undefined, false) };
    default: throw new DomainError(400, 'that assistant action is not supported');
  }
}

export async function answerAssistant(message: string, caller: Caller | undefined, requestedTool?: string, requestedInput?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const provider = process.env.MODEL_PROVIDER || 'stub';
  if (provider !== 'stub' && provider !== 'ollama') {
    throw new DomainError(500, 'unsupported assistant model provider');
  }
  const call = requestedTool
    ? stubCall(message, requestedTool, requestedInput)
    : provider === 'ollama'
      ? await ollamaCall(message)
      : stubCall(message);
  if (!call) return { reply: `${callerLabel(caller)} I can search upcoming sessions, report your credits or bookings, and help with a booking. Tell me what you need.` };
  const data = await executeTool(call, caller);
  const dataRecord = data as Record<string, unknown>;
  if (call.name === 'my_credits') return { reply: `${callerLabel(caller)} Your current balance is ${dataRecord.credits} credits.`, tool: call.name, data };
  if (call.name === 'search_sessions') return { reply: `${callerLabel(caller)} Here are the sessions visible to you.`, tool: call.name, data };
  if (call.name === 'my_bookings') return { reply: `${callerLabel(caller)} Here are your bookings.`, tool: call.name, data };
  if (call.name === 'book_session') return { reply: caller ? 'Your booking was processed.' : 'Your request was received.', tool: call.name, data };
  return { reply: 'The requested Atrium action was processed.', tool: call.name, data };
}
