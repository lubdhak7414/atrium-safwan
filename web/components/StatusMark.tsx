type Status = 'scheduled' | 'completed' | 'cancelled' | 'busy';

const configs: Record<Status, { mark: string; label: string; className: string }> = {
  scheduled: { mark: '□', label: 'SCHEDULED', className: 'status-scheduled' },
  completed: { mark: '■', label: 'COMPLETED', className: 'status-completed' },
  cancelled: { mark: '✕', label: 'CANCELLED', className: 'status-cancelled' },
  busy: { mark: '▨', label: 'OCCUPIED', className: 'status-busy' }
};

export function StatusMark({ status }: { status: Status }) {
  const config = configs[status];
  return (
    <span className={`status-badge ${config.className}`}>
      <span className="status-mark" aria-hidden="true">{config.mark}</span>
      <span>{config.label}</span>
    </span>
  );
}
